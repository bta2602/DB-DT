StudyHUB — команда из четырёх участников

Это UI-версия без демонстрационных данных. Backend подключается отдельно.
Предоставленный серверный код — API-контракт и правила, не работающий HTTP-сервер.

DiasD3v: app/page.tsx, HTML/JS в public/studyhub/, tests/frontend/.
bta2602: lib/studyhub/, tests/backend/, docs/studyhub/API.txt.
bekulanbalkashbay-dot: database/.
didarochKA: CSS в public/studyhub/, tests/ui/, документы приёмки.

Файлы участников не пересекаются. Каталоги public/studyhub/ и tests/ общие:
при копировании их объединяют, не удаляют и не заменяют целиком.
app/page.tsx — единственный заменяемый файл исходного стартового проекта.
Существующие package.json и package-lock.json остаются без изменений.

После добавления всех четырёх частей в существующий Next.js-проект:
npm ci
npm run dev

Главная страница перенаправляет на /studyhub/index.html.
Форма входа не пропускает в кабинет, пока команда не реализует /api/*.

Проверки:
node --test tests/frontend/api.test.mjs tests/frontend/logic.test.mjs tests/backend/policy.test.mjs tests/ui/publication.test.cjs
npm run build

В полном репозитории проверены 24 Node-теста и пути между файлами.
Next.js build выполнен успешно с зависимостями из package-lock.json.
Миграция не применена. Сайт не опубликован. Реальные учётные записи не созданы.
