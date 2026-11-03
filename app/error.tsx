'use client';

import Link from 'next/link';

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="route-state" id="main">
      <h1>Не удалось открыть страницу</h1>
      <p>Попробуйте ещё раз. Сохранённые данные останутся в базе.</p>
      <div className="flex">
        <button className="button primary" onClick={reset}>
          Повторить
        </button>
        <Link className="button" href="/">
          На главную
        </Link>
      </div>
    </main>
  );
}
