import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="route-state" id="main">
      <p className="eyebrow">StudyHUB · 404</p>
      <h1>Страница не найдена</h1>
      <p>Проверьте адрес или вернитесь в свой кабинет.</p>
      <Link className="button primary" href="/">
        На главную
      </Link>
    </main>
  );
}
