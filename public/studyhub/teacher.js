/** Teacher views. Server data and session are supplied by the application shell. */
export function createTeacherUI(ctx) {
  const {api, esc, icon, button, empty, heading, formatDate, formatTime} = ctx;
  const labels = {present:'Присутствует', absent:'Отсутствует', late:'Опоздание', excused:'Уважительная причина'};
  const letters = {present:'П', absent:'Н', late:'О', excused:'У'};
  const statuses = {submitted:'На проверке', reviewed:'Проверено', revision:'На доработке', missing:'Не сдано'};
  const freshView = () => ({groupId:'', subjectId:'', lessonId:'', tab:'grades', search:'', queueGroup:'', queueAssignment:'', queueStatus:'submitted', queueSearch:'', reviewId:null, assignmentGroup:''});
  let view = freshView(), busy = false, activePage = '', previewURL = null, previewSequence = 0;
  const attendanceDrafts = new Map(), reviewDrafts = new Map(), fileCache = new Map();
  const data = () => ctx.getData();
  const ownPairs = () => (data().teachingAssignments || []).filter(x => x.teacherId === ctx.getUser()?.id);
  const ownGroups = () => (data().groups || []).filter(g => ownPairs().some(x => x.groupId === g.id));
  const ownSubjects = (groupId = view.groupId) => (data().subjects || []).filter(s => ownPairs().some(x => x.groupId === groupId && x.subjectId === s.id));
  const ownAssignments = () => (data().assignments || []).filter(a => a.teacherId === ctx.getUser()?.id && ownPairs().some(p => p.groupId === a.groupId && p.subjectId === a.subjectId));
  const ownLessons = () => (data().lessons || []).filter(l => l.teacherId === ctx.getUser()?.id && l.status !== 'cancelled' && ownPairs().some(p => p.groupId === l.groupId && p.subjectId === l.subjectId));
  const find = (kind, id) => (data()[kind] || []).find(x => x.id === id);
  const title = (kind, id) => find(kind,id)?.name || 'Не указано';
  const roster = groupId => (data().users || []).filter(s => s.role === 'student' && s.groupId === groupId);
  const filteredRoster = () => roster(view.groupId).filter(s => s.name.toLocaleLowerCase('ru').includes(view.search.trim().toLocaleLowerCase('ru')));
  const validGrade = n => [2,3,4,5].includes(n);
  const mean = grades => {const good = grades.filter(validGrade);return good.length ? (good.reduce((a,b)=>a+b,0)/good.length).toFixed(1).replace('.',',') : '—';};
  const person = s => `<div class="student-cell"><span class="avatar">${esc((s?.name||'').split(' ').map(x=>x[0]).slice(0,2).join(''))}</span><div><strong>${esc(s?.name||'Студент')}</strong><small>${esc(title('groups',s?.groupId))}</small></div></div>`;
  const badge = status => `<span class="pill ${status==='submitted'?'blue':status==='revision'?'amber':status==='missing'?'neutral':''}">${statuses[status]||''}</span>`;
  const attr = value => esc(value);
  function ensureSelection() {
    const groups = ownGroups();
    if (!groups.some(g=>g.id===view.groupId)) view.groupId = groups[0]?.id || '';
    const subjects = ownSubjects();
    if (!subjects.some(s=>s.id===view.subjectId)) view.subjectId = subjects[0]?.id || '';
    const lessons = lessonList();
    if (!lessons.some(l=>l.id===view.lessonId)) view.lessonId = lessons.filter(l=>Date.parse(l.startsAt)<=Date.now()).at(-1)?.id || lessons[0]?.id || '';
  }
  function lessonList() {return ownLessons().filter(l=>l.groupId===view.groupId && l.subjectId===view.subjectId).sort((a,b)=>Date.parse(a.startsAt)-Date.parse(b.startsAt));}
  function columns() {
    return [...lessonList().map(l=>({kind:'lesson', id:l.id, date:l.startsAt, label:l.kind, value:l})), ...ownAssignments().filter(a=>a.groupId===view.groupId && a.subjectId===view.subjectId).map(a=>({kind:'assignment',id:a.id,date:a.dueAt,label:a.title,value:a}))].sort((a,b)=>Date.parse(a.date)-Date.parse(b.date));
  }
  function submission(assignmentId, studentId) {return (data().submissions||[]).find(s=>s.assignmentId===assignmentId && s.studentId===studentId);}
  function gradeRecord(lessonId,studentId) {return (data().grades||[]).find(g=>g.lessonId===lessonId && g.studentId===studentId);}
  function columnGrade(col, studentId) {return col.kind==='lesson' ? gradeRecord(col.id,studentId)?.grade ?? null : (submission(col.id,studentId)?.status==='reviewed' ? submission(col.id,studentId).grade : null);}
  function journalFilters() {
    return `<div class="teacher-toolbar"><div class="teacher-filters"><label class="field">Учебная группа<select aria-label="Группа журнала" data-t="groupId">${ownGroups().map(g=>`<option value="${attr(g.id)}" ${g.id===view.groupId?'selected':''}>${esc(g.name)}</option>`).join('')}</select></label><label class="field">Предмет<select aria-label="Предмет журнала" data-t="subjectId">${ownSubjects().map(s=>`<option value="${attr(s.id)}" ${s.id===view.subjectId?'selected':''}>${esc(s.name)}</option>`).join('')}</select></label>${view.tab==='attendance'?`<label class="field">Занятие<select class="teacher-lesson-selector" aria-label="Занятие для посещаемости" data-t="lessonId">${lessonList().map(l=>`<option value="${attr(l.id)}" ${l.id===view.lessonId?'selected':''}>${esc(formatDate(l.startsAt))} · ${esc(formatTime(l.startsAt))}–${esc(formatTime(l.endsAt))}</option>`).join('')}</select></label>`:''}</div><div class="search-field">${icon('search','sm')}<input id="t-student-search" data-t-search="student" aria-label="Найти студента в журнале" placeholder="Найти студента…" value="${attr(view.search)}"></div></div>`;
  }
  function journal() {
    ensureSelection();
    const top = heading('Журнал группы','Оценки и посещаемость по занятиям.');
    if (!ownGroups().length) return top + empty('Группы ещё не назначены','Журнал появится после назначения группы и предмета администратором.');
    return `${top}<div class="teacher-subtabs"><div class="tabs" role="tablist" aria-label="Раздел журнала">${[['grades','Оценки'],['attendance','Посещаемость']].map(([key,label])=>`<button type="button" role="tab" aria-selected="${view.tab===key}" class="${view.tab===key?'active':''}" data-action="t-tab" data-tab="${key}">${label}</button>`).join('')}</div><span class="save-state">${view.tab==='grades'?'Оценки сохраняются после выбора':'Отметки сохраняются по кнопке'}</span></div>${journalFilters()}${view.tab==='grades'?gradesView():attendanceView()}`;
  }
  function gradesView() {
    const cols = columns(), students = filteredRoster();
    if (!cols.length) return empty('Нет занятий или заданий','Они появятся в журнале после добавления в расписание или создания задания.');
    return `<section class="card"><div class="teacher-journal-head"><div><h2>${esc(title('subjects',view.subjectId))} · ${esc(title('groups',view.groupId))}</h2><p>Шкала 2–5 · «—» означает отсутствие оценки</p></div></div><div class="teacher-table-wrap"><table class="teacher-grade-table"><thead><tr><th>Студент</th>${cols.map(c=>`<th><strong>${esc(formatDate(c.date))}</strong><small>${esc(c.label)}${c.kind==='lesson'&&Date.parse(c.date)>Date.now()?'<br>Будущее занятие':''}</small></th>`).join('')}<th>Средний<br>балл</th></tr></thead><tbody>${students.map(s=>`<tr><td>${person(s)}</td>${cols.map(c=>{const grade=columnGrade(c,s.id); if(c.kind==='assignment'){const work=submission(c.id,s.id);return `<td>${work?`<button class="grade-select ${grade==null?'blank':''}" data-action="t-open-review" data-id="${attr(work.id)}" aria-label="Работа: ${attr(s.name)}, ${attr(c.label)}">${grade??'—'}</button>`:'<span class="teacher-empty-cell">—</span>'}</td>`;} return `<td><select class="grade-select ${grade==null?'blank':grade<4?'low':''}" data-t-grade="${attr(c.id)}" data-student="${attr(s.id)}" aria-label="Оценка: ${attr(s.name)}, ${attr(formatDate(c.date))}, ${attr(formatTime(c.date))}, ${attr(c.label)}" ${busy||Date.parse(c.date)>Date.now()?'disabled':''}><option value="" ${grade==null?'selected':''}>—</option>${[5,4,3,2].map(n=>`<option value="${n}" ${grade===n?'selected':''}>${n}</option>`).join('')}</select></td>`;}).join('')}<td><span class="teacher-average">${mean(cols.map(c=>columnGrade(c,s.id)))}</span></td></tr>`).join('')||`<tr><td colspan="${cols.length+2}">${empty('Студентов не найдено','Измените поиск или дождитесь добавления студентов в группу.')}</td></tr>`}</tbody></table></div></section><p class="journal-help">Выберите оценку за занятие. Чтобы проверить задание, откройте его ячейку.</p><p class="teacher-mobile-note">Прокрутите журнал вправо. Имена студентов остаются видимыми.</p>`;
  }
  function attendanceState(lesson) {
    const committed = Object.fromEntries((data().attendance||[]).filter(a=>a.lessonId===lesson.id).map(a=>[a.studentId,a.status]));
    const draft = attendanceDrafts.get(lesson.id);
    const entries = draft?.entries || committed;
    const students = roster(lesson.groupId);
    const counts = {present:0,absent:0,late:0,excused:0,unmarked:0};
    students.forEach(s=>counts[Object.hasOwn(labels,entries[s.id])?entries[s.id]:'unmarked']++);
    return {entries,committed,counts,dirty:students.some(s=>(entries[s.id]||null)!==(committed[s.id]||null)),version:draft?.version ?? lesson.attendanceVersion};
  }
  function attendanceView() {
    const lesson = ownLessons().find(l=>l.id===view.lessonId);
    if (!lesson) return empty('Занятий пока нет','Выберите другую группу или предмет.');
    const {entries,counts,dirty} = attendanceState(lesson), future = Date.parse(lesson.startsAt)>Date.now();
    return `<section class="card"><div class="attendance-context"><div><h2>${esc(title('groups',lesson.groupId))} · ${esc(formatDate(lesson.startsAt))}</h2><p>${esc(formatTime(lesson.startsAt))}–${esc(formatTime(lesson.endsAt))} · аудитория ${esc(title('rooms',lesson.roomId))} · ${esc(lesson.kind)}</p></div>${button(view.search?'Неотмеченные из поиска':'Остальные присутствуют','t-mark-rest','soft small',busy||future||!filteredRoster().some(s=>!entries[s.id])?'disabled':'')}</div><div class="attendance-metrics">${[['present','Присутствуют'],['absent','Нет'],['late','Опоздали'],['excused','Уважительная'],['unmarked','Не отмечены']].map(([k,label])=>`<span><strong>${counts[k]}</strong>${label}</span>`).join('')}</div><div class="teacher-table-wrap"><table class="attendance-table"><thead><tr><th>Студент</th><th class="attendance-row-status">Отметка</th><th>П · Н · О · У</th></tr></thead><tbody>${filteredRoster().map(s=>`<tr><td>${person(s)}</td><td class="attendance-row-status">${labels[entries[s.id]]||'Не отмечен'}</td><td><div class="attendance-buttons">${Object.keys(labels).map(k=>`<button type="button" aria-label="${attr(s.name)}: ${labels[k]}" aria-pressed="${entries[s.id]===k}" class="${k} ${entries[s.id]===k?'selected':''}" data-action="t-mark" data-student="${attr(s.id)}" data-value="${k}" ${busy||future?'disabled':''}>${letters[k]}</button>`).join('')}</div></td></tr>`).join('')||`<tr><td colspan="3">${empty('Студентов не найдено','Измените поиск или выберите другую группу.')}</td></tr>`}</tbody></table></div><div class="attendance-savebar"><div><p>${future?'Будущее занятие':dirty?'Есть несохранённые отметки':counts.unmarked===roster(lesson.groupId).length?'Посещаемость ещё не отмечена':'Отметки сохранены'}</p><small>Студент видит только сохранённые отметки.</small><div class="error-text" id="t-attendance-error" role="status"></div></div><div class="actions">${button('Отменить изменения','t-discard-attendance','small',busy||!dirty?'disabled':'')}${button(busy?'Сохранение…':'Сохранить отметки','t-save-attendance','primary',busy||!dirty||future?'disabled':'')}</div></div></section><div class="attendance-legend">${Object.keys(labels).map(k=>`<span><strong>${letters[k]}</strong>${labels[k]}</span>`).join('')}<span>Повторное нажатие снимает отметку.</span></div>`;
  }
  function records() {
    return ownAssignments().flatMap(a=>roster(a.groupId).map(student=>({assignment:a,student,submission:submission(a.id,student.id)})));
  }
  function queueRows() {
    return records().filter(r=>(!view.queueGroup||r.assignment.groupId===view.queueGroup)&&(!view.queueAssignment||r.assignment.id===view.queueAssignment)&&(r.submission?.status||'missing')===view.queueStatus&&`${r.student.name} ${r.assignment.title}`.toLocaleLowerCase('ru').includes(view.queueSearch.trim().toLocaleLowerCase('ru'))).sort((a,b)=>Date.parse(a.submission?.submittedAt||0)-Date.parse(b.submission?.submittedAt||0));
  }
  function queueTable(rows) {
    return `<table class="review-table"><thead><tr><th>Студент</th><th>Задание</th><th>Сдача</th><th>Статус</th><th><span class="visually-hidden">Действие</span></th></tr></thead><tbody>${rows.map(r=>`<tr><td>${person(r.student)}</td><td><div class="work-title">${esc(r.assignment.title)}</div><div class="work-meta">${esc(title('subjects',r.assignment.subjectId))}</div></td><td>${r.submission?`${esc(formatDate(r.submission.submittedAt))} · ${esc(formatTime(r.submission.submittedAt))}${Date.parse(r.submission.submittedAt)>Date.parse(r.assignment.dueAt)?'<div class="work-meta">После срока</div>':''}`:'—'}</td><td>${badge(r.submission?.status||'missing')}${validGrade(r.submission?.grade)?`<span class="grade">${r.submission.grade}</span>`:''}</td><td>${r.submission?button(r.submission.status==='submitted'?'Проверить':'Открыть','t-open-review','small',`data-id="${attr(r.submission.id)}"`):button('Условия','t-assignment-info','small',`data-id="${attr(r.assignment.id)}"`)}</td></tr>`).join('')}</tbody></table>`;
  }
  function reviewQueue() {
    const all = records(), rows = queueRows();
    return `${heading('Работы на проверку','Сначала самые ранние сдачи. Оценка и комментарий — рядом с работой.')}<div class="teacher-queue-tabs"><div class="tabs" role="tablist" aria-label="Статус проверки">${Object.entries(statuses).map(([k,label])=>`<button type="button" role="tab" aria-selected="${view.queueStatus===k}" class="${view.queueStatus===k?'active':''}" data-action="t-queue-tab" data-tab="${k}">${label}<span class="tab-number">${all.filter(r=>(r.submission?.status||'missing')===k).length}</span></button>`).join('')}</div></div><div class="teacher-toolbar"><div class="teacher-filters"><label class="field">Группа<select data-t="queueGroup" aria-label="Группа работ"><option value="">Все мои группы</option>${ownGroups().map(g=>`<option value="${attr(g.id)}" ${g.id===view.queueGroup?'selected':''}>${esc(g.name)}</option>`).join('')}</select></label><label class="field">Задание<select data-t="queueAssignment" aria-label="Задание в очереди"><option value="">Все задания</option>${ownAssignments().filter(a=>!view.queueGroup||a.groupId===view.queueGroup).map(a=>`<option value="${attr(a.id)}" ${a.id===view.queueAssignment?'selected':''}>${esc(a.title)}</option>`).join('')}</select></label></div><div class="search-field">${icon('search','sm')}<input id="t-work-search" data-t-search="work" aria-label="Поиск по работам" placeholder="Студент или название работы…" value="${attr(view.queueSearch)}"></div></div><div class="card teacher-table-wrap" id="t-queue-results">${rows.length?queueTable(rows):empty('Работ не найдено',ownAssignments().length?'Измените фильтры или дождитесь новых сдач.':'Сначала создайте задание для назначенной группы.')}</div>`;
  }
  function selectedRecord() {return records().find(r=>r.submission?.id===view.reviewId);}
  function reviewDraft(work) {
    if (!reviewDrafts.has(work.id)) reviewDrafts.set(work.id,{grade:work.status==='reviewed'?work.grade:null,comment:work.comment||'',version:work.version});
    return reviewDrafts.get(work.id);
  }
  function reviewWorkspace() {
    const record = selectedRecord();
    if (!record) {view.reviewId=null;return reviewQueue();}
    const {student,assignment,submission:work} = record, draft=reviewDraft(work), rows=queueRows();
    const position=rows.findIndex(r=>r.submission?.id===work.id);
    return `<button class="text-link back-link" data-action="t-review-back">${icon('left','sm')}К списку работ</button><div class="review-workspace-head"><div><h1>${esc(student.name)}</h1><p>${esc(title('groups',student.groupId))} · ${esc(assignment.title)}</p></div><div class="review-navigation">${position>=0?`<span>${position+1} из ${rows.length}</span>`:''}</div></div><div class="review-layout"><div><section class="card work-preview"><header class="work-preview-header">${icon('file')}<div class="grow"><strong>${esc(work.file?.name||'Работа студента')}</strong><small>${esc(formatDate(work.submittedAt))} · ${esc(formatTime(work.submittedAt))}</small></div>${badge(work.status)}</header><div id="t-file-preview"><div class="preview-empty">Открываем файл…</div></div></section><details class="work-conditions"><summary>Условия задания и требования</summary><div class="conditions-content"><p>${esc(assignment.description)}</p><ol>${(assignment.steps||[]).map(s=>`<li>${esc(s)}</li>`).join('')}</ol><p>Срок: ${esc(formatDate(assignment.dueAt))}, ${esc(formatTime(assignment.dueAt))}</p></div></details></div><aside class="card review-feedback">${work.status!=='submitted'?`<div class="review-published ${work.status==='revision'?'revision':''}">${work.status==='reviewed'?`Выставлена оценка ${work.grade}`:'Работа возвращена на доработку.'}${work.comment?`<br>${esc(work.comment)}`:''}</div>`:''}<h2>Оценка и обратная связь</h2><p class="caption">Результат появится у студента после сохранения.</p><div class="review-grade-picker" role="group" aria-label="Выбрать оценку за работу">${[2,3,4,5].map(n=>`<button type="button" aria-label="Оценка ${n}" aria-pressed="${draft.grade===n}" class="${draft.grade===n?'selected':''}" data-action="t-review-grade" data-value="${n}" ${busy?'disabled':''}>${n}</button>`).join('')}</div><label class="field">Комментарий студенту<textarea id="t-feedback" data-t-feedback maxlength="2000" placeholder="Что получилось и что стоит улучшить…" ${busy?'disabled':''}>${esc(draft.comment)}</textarea></label><div class="review-quick-comments">${['Хорошая работа!','Добавьте пояснение к решению.','Проверьте выполнение всех требований.'].map(text=>`<button type="button" data-action="t-quick-comment" data-text="${attr(text)}" ${busy?'disabled':''}>${text}</button>`).join('')}</div><div id="t-review-error" class="review-form-error" role="status"></div><div class="feedback-actions">${button(busy?'Сохранение…':`Сохранить и следующая ${icon('arrow','sm')}`,'t-publish-next','primary full',busy||!validGrade(draft.grade)?'disabled':'')}${button('Сохранить оценку','t-publish','full',busy||!validGrade(draft.grade)?'disabled':'')}${button('Вернуть на доработку','t-return','full',busy?'disabled':'')}</div><p class="caption mt">Для доработки обязательно укажите, что нужно исправить.</p></aside></div>`;
  }
  function assignments() {
    const list=ownAssignments().filter(a=>!view.assignmentGroup||a.groupId===view.assignmentGroup);
    return `${heading('Мои задания','Условия, сроки и прогресс каждой группы.',button(`${icon('plus','sm')}Создать задание`,'t-new-assignment','primary',!ownPairs().length?'disabled':''))}<div class="teacher-toolbar"><div class="teacher-filters"><label class="field">Группа<select data-t="assignmentGroup" aria-label="Группа заданий"><option value="">Все мои группы</option>${ownGroups().map(g=>`<option value="${attr(g.id)}" ${g.id===view.assignmentGroup?'selected':''}>${esc(g.name)}</option>`).join('')}</select></label></div></div><div class="teacher-assignments">${list.map(a=>{const rows=records().filter(r=>r.assignment.id===a.id);return `<article class="card teacher-assignment-card"><span class="pill neutral">${esc(title('groups',a.groupId))}</span><h2>${esc(a.title)}</h2><p>${esc(title('subjects',a.subjectId))} · до ${esc(formatDate(a.dueAt))}, ${esc(formatTime(a.dueAt))}</p><div class="teacher-assignment-counts">${[['submitted','На проверке'],['reviewed','Проверено'],['missing','Не сдали']].map(([status,label])=>`<div><strong>${rows.filter(r=>(r.submission?.status||'missing')===status).length}</strong><small>${label}</small></div>`).join('')}</div><div class="card-actions">${button('Условия','t-assignment-info','small',`data-id="${attr(a.id)}"`)}${button('Работы группы','t-assignment-queue','small primary',`data-id="${attr(a.id)}"`)}</div></article>`;}).join('')||empty('Заданий пока нет',ownPairs().length?'Создайте задание для своей группы.':'Администратор ещё не назначил вам группы и предметы.')}</div>`;
  }
  function newAssignment() {
    ensureSelection();
    if (!ownPairs().length) return;
    ctx.modal('Создать задание',`<form id="t-assignment-form"><label class="field">Название<input name="title" required maxlength="120" placeholder="Название задания"></label><div class="form-row"><label class="field">Группа<select name="groupId" data-t-new-group>${ownGroups().map(g=>`<option value="${attr(g.id)}" ${g.id===view.groupId?'selected':''}>${esc(g.name)}</option>`).join('')}</select></label><label class="field">Предмет<select name="subjectId">${ownSubjects().map(s=>`<option value="${attr(s.id)}">${esc(s.name)}</option>`).join('')}</select></label></div><div class="form-row"><label class="field">Срок сдачи (UTC+5)<input type="datetime-local" name="dueAt" required></label><label class="field">Тип<select name="type"><option>Лабораторная работа</option><option>Практическая работа</option><option>Домашнее задание</option></select></label></div><label class="field">Условия выполнения<textarea name="description" required maxlength="3000" placeholder="Что нужно сделать и какой результат приложить"></textarea></label><label class="field">Этапы выполнения<textarea name="steps" maxlength="3000" placeholder="Один этап на строку"></textarea></label><div id="t-assignment-error" class="error-text" role="status"></div><div class="form-actions">${button('Отмена','close')}<button class="button primary" type="submit">Создать задание</button></div></form>`);
  }
  function showAssignment(id) {
    const a=ownAssignments().find(x=>x.id===id);if(!a)return;
    ctx.modal(a.title,`<p>${esc(a.description)}</p><ol>${(a.steps||[]).map(s=>`<li>${esc(s)}</li>`).join('')}</ol><p class="small muted mt">${esc(title('groups',a.groupId))} · ${esc(formatDate(a.dueAt))}, ${esc(formatTime(a.dueAt))}</p><div class="form-actions">${button('Закрыть','close')}${button('Работы группы','t-assignment-queue','primary',`data-id="${attr(a.id)}"`)}</div>`);
  }
  function fail(error, selector) {
    const message=error?.message||'Не удалось сохранить изменения. Повторите попытку.';
    const target=selector&&document.querySelector(selector);if(target)target.textContent=message;else ctx.toast(message);
  }
  async function publish(action,next) {
    const r=selectedRecord();if(!r||busy)return;
    const work=r.submission,draft=reviewDraft(work);
    draft.comment=document.querySelector('#t-feedback')?.value??draft.comment;
    if(action==='grade'&&!validGrade(draft.grade)){fail(new Error('Выберите оценку от 2 до 5.'),'#t-review-error');return;}
    if(action==='return'&&!draft.comment.trim()){fail(new Error('Напишите, что студенту нужно доработать.'),'#t-review-error');return;}
    const queue=queueRows().map(x=>x.submission?.id).filter(Boolean),index=queue.indexOf(work.id);
    busy=true;ctx.render();
    try {
      await ctx.mutate('PATCH',`/api/submissions/${encodeURIComponent(work.id)}/review`,{action,grade:action==='return'?null:draft.grade,comment:draft.comment.trim(),version:draft.version});
      reviewDrafts.delete(work.id);
      if(next){view.reviewId=queue.slice(index+1).find(id=>queueRows().some(x=>x.submission?.id===id))||queueRows().find(x=>x.submission?.id!==work.id)?.submission?.id||null;}
      else view.queueStatus=action==='return'?'revision':'reviewed';
      busy=false;ctx.render();ctx.toast(action==='return'?'Работа возвращена на доработку.':'Оценка сохранена.');
    } catch(error) {busy=false;ctx.render();fail(error,'#t-review-error');}
  }
  function setAttendance(studentId,status) {
    const lesson=ownLessons().find(l=>l.id===view.lessonId);if(!lesson||Date.parse(lesson.startsAt)>Date.now())return;
    if(!roster(lesson.groupId).some(s=>s.id===studentId))return;
    const current=attendanceState(lesson);
    attendanceDrafts.set(lesson.id,{entries:{...current.entries,[studentId]:current.entries[studentId]===status?null:status},version:current.version});
  }
  async function click(action,el) {
    if(!action?.startsWith('t-'))return false;
    if(busy)return true;
    if(action==='t-tab'){view.tab=el.dataset.tab;ctx.render();}
    else if(action==='t-mark'){setAttendance(el.dataset.student,el.dataset.value);ctx.render();}
    else if(action==='t-mark-rest'){
      const lesson=ownLessons().find(l=>l.id===view.lessonId);if(lesson&&Date.parse(lesson.startsAt)<=Date.now()){const current=attendanceState(lesson),entries={...current.entries};filteredRoster().forEach(s=>{if(!entries[s.id])entries[s.id]='present';});attendanceDrafts.set(lesson.id,{entries,version:current.version});ctx.render();}
    } else if(action==='t-discard-attendance'){attendanceDrafts.delete(view.lessonId);ctx.render();}
    else if(action==='t-save-attendance'){
      const lesson=ownLessons().find(l=>l.id===view.lessonId);if(!lesson||Date.parse(lesson.startsAt)>Date.now())return true;
      const current=attendanceState(lesson);if(!current.dirty)return true;busy=true;ctx.render();
      try {await ctx.mutate('PUT',`/api/lessons/${encodeURIComponent(lesson.id)}/attendance`,{entries:roster(lesson.groupId).map(s=>({studentId:s.id,status:current.entries[s.id]||null})),version:current.version});attendanceDrafts.delete(lesson.id);busy=false;ctx.render();ctx.toast('Посещаемость сохранена.');}
      catch(error){busy=false;ctx.render();fail(error,'#t-attendance-error');}
    } else if(action==='t-queue-tab'){view.queueStatus=el.dataset.tab;view.reviewId=null;ctx.render();}
    else if(action==='t-open-review'){
      const record=records().find(r=>r.submission?.id===el.dataset.id);if(!record)return true;
      view.reviewId=record.submission.id;view.queueStatus=record.submission.status;view.queueGroup='';view.queueAssignment='';view.queueSearch='';
      if(activePage!=='review'){activePage='review';if(ctx.navigate)ctx.navigate('review');else{window.dispatchEvent(new CustomEvent('studyhub:navigate',{detail:{page:'review'}}));}}
      ctx.render();
    } else if(action==='t-review-back'){view.reviewId=null;ctx.render();}
    else if(action==='t-review-grade'){const r=selectedRecord();if(r){reviewDraft(r.submission).grade=Number(el.dataset.value);ctx.render();}}
    else if(action==='t-quick-comment'){const r=selectedRecord();if(r){const d=reviewDraft(r.submission);d.comment=[d.comment.trim(),el.dataset.text].filter(Boolean).join(' ').slice(0,2000);const input=document.querySelector('#t-feedback');if(input){input.value=d.comment;input.focus();}}}
    else if(action==='t-publish'||action==='t-publish-next')await publish('grade',action==='t-publish-next');
    else if(action==='t-return')await publish('return',false);
    else if(action==='t-new-assignment')newAssignment();
    else if(action==='t-assignment-info')showAssignment(el.dataset.id);
    else if(action==='t-assignment-queue'){view.queueAssignment=el.dataset.id;view.queueGroup='';view.queueStatus='submitted';view.queueSearch='';view.reviewId=null;ctx.closeModal();if(ctx.navigate)ctx.navigate('review');else window.dispatchEvent(new CustomEvent('studyhub:navigate',{detail:{page:'review'}}));ctx.render();}
    else if(action==='t-download'){
      const r=selectedRecord();if(r?.submission.file){try{const blob=await getFile(r.submission.file);const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=r.submission.file.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(error){fail(error);}}
    }
    return true;
  }
  async function change(el) {
    if(el.hasAttribute('data-t-new-group')){const subjects=ownSubjects(el.value);const select=el.form?.querySelector('[name="subjectId"]');if(select)select.innerHTML=subjects.map(s=>`<option value="${attr(s.id)}">${esc(s.name)}</option>`).join('');return true;}
    if(el.dataset.t){const key=el.dataset.t;if(Object.hasOwn(view,key)){view[key]=el.value;if(key==='groupId'||key==='subjectId'){view.lessonId='';view.search='';}if(key==='queueGroup')view.queueAssignment='';ctx.render();}return true;}
    if(el.hasAttribute('data-t-grade')){
      if(busy)return true;
      const lesson=ownLessons().find(l=>l.id===el.dataset.tGrade),studentId=el.dataset.student;
      if(!lesson||Date.parse(lesson.startsAt)>Date.now()||!roster(lesson.groupId).some(s=>s.id===studentId))return true;
      const grade=el.value===''?null:Number(el.value);if(grade!==null&&!validGrade(grade))return true;
      const current=gradeRecord(lesson.id,studentId);busy=true;el.disabled=true;
      try{await ctx.mutate('PUT',`/api/lessons/${encodeURIComponent(lesson.id)}/grades/${encodeURIComponent(studentId)}`,{grade,version:current?.version??null});busy=false;ctx.render();[...document.querySelectorAll('select[data-t-grade]')].find(control=>control.dataset.tGrade===lesson.id&&control.dataset.student===studentId)?.focus();ctx.toast('Оценка сохранена.');}
      catch(error){busy=false;el.disabled=false;el.value=current?.grade==null?'':String(current.grade);fail(error);}
      return true;
    }
    return false;
  }
  function input(el) {
    if(el.hasAttribute('data-t-feedback')){const r=selectedRecord();if(r)reviewDraft(r.submission).comment=el.value;return true;}
    if(el.dataset.tSearch==='student'){
      view.search=el.value;const cursor=el.selectionStart;ctx.render();const replacement=document.querySelector('#t-student-search');replacement?.focus();replacement?.setSelectionRange(cursor,cursor);return true;
    }
    if(el.dataset.tSearch==='work'){
      view.queueSearch=el.value;const rows=queueRows(),target=document.querySelector('#t-queue-results');if(target)target.innerHTML=rows.length?queueTable(rows):empty('Работ не найдено','Измените запрос или фильтры.');return true;
    }
    return false;
  }
  async function submit(form) {
    if(form.id!=='t-assignment-form')return false;
    if(busy)return true;
    const f=new FormData(form),get=k=>String(f.get(k)||'').trim();
    const groupId=get('groupId'),subjectId=get('subjectId'),localDueAt=get('dueAt');
    const dueAt=new Date(`${localDueAt}${localDueAt.length===16?':00':''}+05:00`);
    if(!ownPairs().some(p=>p.groupId===groupId&&p.subjectId===subjectId)){fail(new Error('Выберите назначенные вам группу и предмет.'),'#t-assignment-error');return true;}
    if(!get('title')||!get('description')||!Number.isFinite(dueAt.getTime())||dueAt.getTime()<=Date.now()){fail(new Error('Заполните название, условия и будущий срок сдачи.'),'#t-assignment-error');return true;}
    const submitButton=form.querySelector('[type="submit"]');busy=true;if(submitButton)submitButton.disabled=true;
    try{await ctx.mutate('POST','/api/assignments',{title:get('title'),description:get('description'),steps:get('steps').split('\n').map(s=>s.trim()).filter(Boolean),type:get('type'),groupId,subjectId,teacherId:ctx.getUser().id,dueAt:dueAt.toISOString()});busy=false;ctx.closeModal();view.assignmentGroup=groupId;ctx.render();ctx.toast('Задание создано.');}
    catch(error){busy=false;if(submitButton)submitButton.disabled=false;fail(error,'#t-assignment-error');}
    return true;
  }
  async function getFile(file) {
    if(fileCache.has(file.id))return fileCache.get(file.id);
    const blob=await api.file(file.id);if(fileCache.size>=3)fileCache.delete(fileCache.keys().next().value);fileCache.set(file.id,blob);return blob;
  }
  async function afterRender() {
    const sequence=++previewSequence;
    if(previewURL){URL.revokeObjectURL(previewURL);previewURL=null;}
    const target=document.querySelector('#t-file-preview'),r=selectedRecord();
    if(!target||!r)return;
    if(!r.submission.file?.id){target.innerHTML=empty('Файл недоступен','В работе отсутствует прикреплённый файл.');return;}
    try{
      const file=r.submission.file,blob=await getFile(file);
      if(sequence!==previewSequence||!target.isConnected)return;
      if(/\.(sql|txt)$/i.test(file.name)&&blob.size<=1024*1024){const text=await blob.text();if(sequence!==previewSequence||!target.isConnected)return;const pre=document.createElement('pre');pre.className='work-code';pre.textContent=text;target.replaceChildren(pre);}
      else if(['image/png','image/jpeg'].includes(blob.type)){previewURL=URL.createObjectURL(blob);const img=document.createElement('img');img.src=previewURL;img.alt='Прикреплённая работа студента';img.className='work-image';target.replaceChildren(img);}
      else if(blob.type==='application/pdf'){previewURL=URL.createObjectURL(blob);const frame=document.createElement('iframe');frame.src=previewURL;frame.title='Просмотр PDF работы';frame.className='work-pdf';frame.setAttribute('sandbox','');target.replaceChildren(frame);}
      else target.innerHTML=`<div class="preview-empty">${icon('file')}<strong>Для этого формата нет предпросмотра</strong><p>${esc(file.name)}</p>${button('Скачать файл','t-download','small mt')}</div>`;
    }catch(error){if(sequence===previewSequence&&target.isConnected)target.innerHTML=`<div class="preview-empty"><strong>Не удалось открыть файл</strong><p>${esc(error?.message||'Повторите попытку позже.')}</p></div>`;}
  }
  function render(page) {activePage=page;if(page==='journal')return journal();if(page==='review')return view.reviewId?reviewWorkspace():reviewQueue();if(page==='assignments')return assignments();return null;}
  function reset() {view=freshView();attendanceDrafts.clear();reviewDrafts.clear();fileCache.clear();busy=false;activePage='';previewSequence++;if(previewURL)URL.revokeObjectURL(previewURL);previewURL=null;}
  return {render,click,change,input,submit,afterRender,reset};
}
