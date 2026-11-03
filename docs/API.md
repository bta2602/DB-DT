# API StudyHUB

API находится на том же адресе, что и сайт. Типы ответов описаны
в `lib/studyhub/api-contract.ts`, обработчики — в `app/api/`.
Сайт работает на Node.js 24+.

## Сессия

`GET /api/session` создаёт гостевую сессию при необходимости и возвращает:

```json
{ "user": null, "csrfToken": "...", "demoEnabled": true }
```

После входа `user` содержит id, имя, почту, роль, группу и версию записи.
Пароль, его хеш и идентификатор cookie в JSON не передаются.

Все изменяющие запросы отправляют cookie сессии, заголовок
`X-CSRF-Token` и правильный `Origin`. JSON-запросы используют
`Content-Type: application/json`. Для файлов используется `FormData`;
Content-Type с границей multipart выставляет браузер.

| Метод и путь            | Назначение / тело                                               |
| ----------------------- | --------------------------------------------------------------- |
| POST /api/auth/register | `name, email, password, passwordConfirmation`; создаёт студента |
| POST /api/auth/login    | `email, password`                                               |
| POST /api/auth/logout   | Пустой объект                                                   |
| POST /api/auth/demo     | `role: student / teacher / admin`; только в деморежиме          |
| GET /api/bootstrap      | Все доступные этой роли учебные массивы                         |
| PATCH /api/profile      | `name, version`                                                 |

Пароль регистрации — от 12 до 128 символов. Назначить себе роль преподавателя
через регистрацию нельзя. Демо-вход выбирает фиксированный аккаунт и обновляет
сессию; его наличие определяется серверной настройкой и типом базы.

## Администратор

| Метод и путь                  | Поля                                                                          |
| ----------------------------- | ----------------------------------------------------------------------------- |
| POST /api/users               | `name, email, role, groupId, password`                                        |
| PATCH /api/users/:id          | `name, email, role, groupId, version`                                         |
| POST /api/groups              | `name, course, curatorId`                                                     |
| PATCH /api/groups/:id         | Поля группы и `version`                                                       |
| POST /api/subjects            | `name`                                                                        |
| PATCH /api/subjects/:id       | `name, version`                                                               |
| POST /api/rooms               | `name, capacity`                                                              |
| PATCH /api/rooms/:id          | Поля аудитории и `version`                                                    |
| PUT /api/teaching-assignments | `teacherId, groupId, subjectId`                                               |
| POST /api/lessons             | `subjectId, groupId, teacherId, roomId, startsAt, endsAt, kind, note, status` |
| PATCH /api/lessons/:id        | Изменяемые поля занятия и `version`                                           |
| POST /api/announcements       | `title, body`                                                                 |
| DELETE /api/announcements/:id | Пустой объект                                                                 |

Время занятия — ISO с часовым поясом. Интерфейс использует Asia/Qyzylorda.
Сервер запрещает пересечения группы, преподавателя и аудитории.
Курс группы — 1–6; вместимость аудитории — 1–1000 или не указана.
Занятие можно отменить и восстановить; восстановление снова проверяет пересечения.

## Преподаватель и студент

| Метод и путь                           | Доступ и поля                                                                          |
| -------------------------------------- | -------------------------------------------------------------------------------------- |
| POST /api/assignments                  | Преподаватель; `title, description, steps, type, groupId, subjectId, teacherId, dueAt` |
| POST /api/assignments/:id/submission   | Студент; multipart с одним `file`                                                      |
| PATCH /api/submissions/:id/review      | Преподаватель; `action, grade, comment, version`                                       |
| PUT /api/lessons/:id/grades/:studentId | Преподаватель; `grade, version`                                                        |
| PUT /api/lessons/:id/attendance        | Преподаватель; `entries, version`                                                      |
| POST /api/materials                    | Преподаватель; multipart `subjectId, title, file`                                      |
| DELETE /api/materials/:id              | Преподаватель назначенного предмета или администратор; пустой объект                   |
| GET /api/files/:id                     | Только пользователь с доступом к работе или материалу                                  |

Преподаватель работает со своими назначенными предметами и группами.
Студент видит только собственные оценки и работы. Материалы и объявления
читаются через `bootstrap`.

Максимальный файл — 20 МБ; разрешены PDF, DOCX, ZIP, SQL, TXT, PNG, JPG, JPEG.
Проверяются расширение, сигнатура бинарного формата, UTF-8 текстов, размер
и права. Это проверка формата, а не антивирус. Файлы лежат в приватной базе,
не в `public/`, и скачиваются с исходным именем.

## Ответы и конфликты

Успех: `{ "ok": true }`. Вход также возвращает новый `csrfToken`.
После изменения клиент обновляет `/api/bootstrap`.

Ошибка:

```json
{
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "Запись уже изменена. Обновите страницу.",
    "fields": {}
  }
}
```

| Статус | Смысл                                                   |
| ------ | ------------------------------------------------------- |
| 401    | Нужно войти                                             |
| 403    | Недостаточно прав или неверный CSRF/Origin              |
| 404    | Запись не найдена или деморежим выключен                |
| 409    | Конфликт версии, почты или расписания                   |
| 413    | Превышен размер запроса/файла                           |
| 415    | Ожидался JSON или multipart с файлом                    |
| 422    | Ошибка полей или формата                                |
| 429    | Слишком много попыток                                   |
| 503    | Ошибка настройки режима или ещё не загружены демоданные |

`version` берётся из последнего `bootstrap`. Для новой оценки передаётся
`version: null`; для посещаемости — `lesson.attendanceVersion`.
Снятая оценка хранится как `grade: null` с обновлённой версией.
Запись и проверка версии выполняются в одной транзакции.
