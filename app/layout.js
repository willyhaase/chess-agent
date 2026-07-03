import './globals.css';

export const metadata = {
  title: 'Шахматный агент · Stockfish + Claude',
  description: 'Stockfish считает варианты, Claude объясняет их по-человечески',
};

export default function RootLayout({ children }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
