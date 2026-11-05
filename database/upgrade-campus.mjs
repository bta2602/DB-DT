import { cleanText, campusNotices } from './seeds/clean-records.mjs';
import { CAMPUS_SEED_ID, LESSON_SLOTS } from './seeds/campus-data.mjs';

export function readSeedContext(db) {
  return {
    users: db
      .prepare('SELECT id,name,email,role,group_id AS groupId,version FROM auth_users')
      .all(),
    groups: db
      .prepare(
        'SELECT id,name,course,curator_id AS curatorId,version FROM school_groups ORDER BY id',
      )
      .all(),
    subjects: db.prepare('SELECT id,name,version FROM school_subjects ORDER BY id').all(),
    rooms: db.prepare('SELECT id,name,capacity,version FROM school_rooms ORDER BY id').all(),
    teachingAssignments: db
      .prepare(
        'SELECT teacher_id AS teacherId,group_id AS groupId,subject_id AS subjectId FROM school_teaching_assignments',
      )
      .all(),
    lessons: db
      .prepare(
        'SELECT id,group_id AS groupId,subject_id AS subjectId,teacher_id AS teacherId,room_id AS roomId,starts_at AS startsAt,ends_at AS endsAt,status,version FROM school_lessons ORDER BY starts_at,id',
      )
      .all(),
  };
}

// Одноразовая совместимая правка старых сгенерированных записей перед пакетом v3.
// UUID записей из интерфейса, пароли, оценки, посещаемость и сданные работы сохраняются.
export function prepareCampusUpgrade(db, now = new Date()) {
  if (db.prepare('SELECT 1 FROM school_demo_seeds WHERE id=?').get(CAMPUS_SEED_ID)) return false;
  const generated = (id) => /^demo-(?!campus-)/.test(id);
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const row of db
      .prepare('SELECT id,name,email FROM auth_users WHERE is_demo=1 AND version=1')
      .all()) {
      if (generated(row.id))
        db.prepare('UPDATE auth_users SET name=?,email=? WHERE id=?').run(
          cleanText(row.name),
          cleanText(row.email),
          row.id,
        );
    }
    for (const table of ['school_groups', 'school_subjects', 'school_rooms']) {
      for (const row of db.prepare(`SELECT id,name FROM ${table} WHERE version=1`).all()) {
        if (!generated(row.id)) continue;
        let name = cleanText(row.name);
        const duplicate = db
          .prepare(`SELECT 1 FROM ${table} WHERE name_key=? AND id<>?`)
          .get(name.toLocaleLowerCase('ru'), row.id);
        if (duplicate) name += ' · основной состав';
        db.prepare(`UPDATE ${table} SET name=?,name_key=? WHERE id=?`).run(
          name,
          name.toLocaleLowerCase('ru'),
          row.id,
        );
      }
    }
    for (const row of db.prepare('SELECT id,capacity FROM school_rooms WHERE version=1').all()) {
      if (generated(row.id) && row.capacity < 24)
        db.prepare('UPDATE school_rooms SET capacity=24 WHERE id=?').run(row.id);
    }
    for (const row of db
      .prepare('SELECT id,title,description,steps_json FROM school_assignments WHERE version=1')
      .all()) {
      if (generated(row.id))
        db.prepare(
          'UPDATE school_assignments SET title=?,description=?,steps_json=? WHERE id=?',
        ).run(
          cleanText(row.title),
          cleanText(row.description),
          JSON.stringify(JSON.parse(row.steps_json).map(cleanText)),
          row.id,
        );
    }
    for (const row of db.prepare('SELECT id,title FROM school_materials').all()) {
      if (generated(row.id))
        db.prepare('UPDATE school_materials SET title=? WHERE id=?').run(
          cleanText(row.title),
          row.id,
        );
    }
    for (const row of db.prepare('SELECT id,title,body FROM school_announcements').all()) {
      if (!generated(row.id)) continue;
      const notice = campusNotices[row.id] || {
        title: cleanText(row.title),
        body: cleanText(row.body),
      };
      db.prepare('UPDATE school_announcements SET title=?,body=? WHERE id=?').run(
        notice.title,
        notice.body,
        row.id,
      );
    }
    for (const row of db.prepare('SELECT id,name,mime_type,contents FROM school_files').all()) {
      if (!generated(row.id) || !row.mime_type.startsWith('text/')) continue;
      const contents = Buffer.from(cleanText(new TextDecoder().decode(row.contents)), 'utf8');
      db.prepare('UPDATE school_files SET name=?,contents=?,bytes=? WHERE id=?').run(
        cleanText(row.name),
        contents,
        contents.length,
        row.id,
      );
    }
    const context = readSeedContext(db);
    const oldLessons = context.lessons.filter(
      (lesson) => generated(lesson.id) && lesson.version === 1,
    );
    const oldIds = new Set(oldLessons.map((lesson) => lesson.id));
    const occupied = context.lessons.filter(
      (lesson) => !oldIds.has(lesson.id) && lesson.status !== 'cancelled',
    );
    const groupIds = context.groups.filter((group) => generated(group.id)).map((group) => group.id);
    const today = Date.parse(
      `${new Date(new Date(now).getTime() + 18000000).toISOString().slice(0, 10)}T00:00:00+05:00`,
    );
    for (const lesson of oldLessons) {
      const localDate = new Date(Date.parse(lesson.startsAt) + 18000000).toISOString().slice(0, 10);
      let day = Date.parse(`${localDate}T00:00:00+05:00`);
      const marked = db
        .prepare(
          'SELECT 1 FROM school_grades WHERE lesson_id=? UNION ALL SELECT 1 FROM school_attendance WHERE lesson_id=? LIMIT 1',
        )
        .get(lesson.id, lesson.id);
      if (marked && day >= today) day = today - 86400000;
      const backwards = Boolean(marked);
      const roster = context.users.filter(
        (user) => user.role === 'student' && user.groupId === lesson.groupId,
      ).length;
      const adequate = context.rooms.filter((room) => room.capacity >= Math.max(20, roster));
      const preferred = adequate.find((room) => room.id === lesson.roomId);
      const candidates = preferred
        ? [preferred, ...adequate.filter((room) => room.id !== preferred.id)]
        : adequate;
      const shift = groupIds.indexOf(lesson.groupId) % 16 < 8 ? 0 : 3;
      let replacement;
      for (
        let attempt = 0;
        attempt < 60 && !replacement;
        attempt++, day += (backwards ? -1 : 1) * 86400000
      ) {
        if ([0, 6].includes(new Date(day + 18000000).getUTCDay())) continue;
        for (const minute of LESSON_SLOTS.slice(shift, shift + 3)) {
          const startsAt = new Date(day + minute * 60000).toISOString();
          const endsAt = new Date(day + (minute + 80) * 60000).toISOString();
          if (marked && Date.parse(endsAt) >= new Date(now).getTime()) continue;
          for (const room of candidates) {
            if (
              occupied.some(
                (other) =>
                  other.startsAt < endsAt &&
                  other.endsAt > startsAt &&
                  (other.groupId === lesson.groupId ||
                    other.teacherId === lesson.teacherId ||
                    other.roomId === room.id),
              )
            )
              continue;
            replacement = { ...lesson, startsAt, endsAt, roomId: room.id };
            break;
          }
          if (replacement) break;
        }
      }
      if (!replacement)
        throw new Error(
          `Не найден учебный слот для занятия ${lesson.id}. Записи оставлены без изменений.`,
        );
      const note = db.prepare('SELECT note FROM school_lessons WHERE id=?').get(lesson.id).note;
      db.prepare(
        'UPDATE school_lessons SET starts_at=?,ends_at=?,room_id=?,note=?,version=version+1 WHERE id=?',
      ).run(
        replacement.startsAt,
        replacement.endsAt,
        replacement.roomId,
        cleanText(note),
        lesson.id,
      );
      if (lesson.status !== 'cancelled') occupied.push(replacement);
    }
    db.exec('COMMIT');
    return true;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
