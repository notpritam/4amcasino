import { useEffect, useRef, useState } from 'react';
import { sendChat } from '../../shared/gameClient.ts';
import { useStore } from '../../shared/store.ts';
import { Button, Input } from '../../shared/ui/index.tsx';

export function ChatPanel() {
  const chat = useStore((s) => s.chat);
  const me = useStore((s) => s.auth.username);
  const [text, setText] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat.length]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    sendChat(text.trim());
    setText('');
  }

  return (
    <div className="flex h-full flex-col rounded-2xl bg-white ring-1 ring-slate-200/70">
      <div className="border-b border-slate-100 px-4 py-3 font-display font-semibold">Chat</div>
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {chat.length === 0 && <p className="text-sm text-slate-400">Say hi — messages are not saved.</p>}
        {chat.map((m, i) => (
          <div key={i} className={m.from === me ? 'text-right' : ''}>
            <div className="text-xs text-slate-400">{m.from}</div>
            <div
              className={`mt-0.5 inline-block max-w-[85%] rounded-2xl px-3 py-1.5 text-sm ${
                m.from === me ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-800'
              }`}
            >
              {m.text}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <form onSubmit={submit} className="flex gap-2 border-t border-slate-100 p-3">
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Message…" maxLength={500} />
        <Button type="submit" variant="secondary" disabled={!text.trim()}>
          Send
        </Button>
      </form>
    </div>
  );
}
