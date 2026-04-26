import { Chat } from '@/components/chat';

export default function HomePage(): React.JSX.Element {
  return (
    <main
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100vh',
        backgroundColor: '#fafafa',
      }}
    >
      <Chat />
    </main>
  );
}
