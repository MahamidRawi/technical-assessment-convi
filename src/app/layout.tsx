import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Convi Case Reasoner',
  description: 'Graph-backed reasoning over Israeli personal-injury cases',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <html lang="he">
      <body
        style={{
          margin: 0,
          padding: 0,
          fontFamily: 'Heebo, Arial, system-ui, -apple-system, sans-serif',
        }}
      >
        {children}
      </body>
    </html>
  );
}
