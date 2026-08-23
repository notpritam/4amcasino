import { useEffect, useRef, useState } from 'react';
import { sendChat } from '../../shared/gameClient.ts';
import { useStore } from '../../shared/store.ts';
import { cn } from '../../shared/lib/cn.ts';
import { Button, Input } from '../../shared/ui/index.tsx';
import { Smiley } from '@phosphor-icons/react';
import { Avatar } from '../../entities/user/Avatar.tsx';

export const STICKERS = ['🔥', '😂', '😭', '🤯', '🃏', '💰', '🐟', '🦈', '🫠', '👏'] as const;
export const QUICK_PHRASES = [
  'nice hand 👏',
  'bluff! 🤨',
  'run it again 🔁',
  'ouch 💀',
  'gg',
  'so lucky 🍀',
] as const;

export function ChatPanel({ chrome = true }: { chrome?: boolean }) {
  const chat = useStore((s) => s.chat);
  const room = useStore((s) => s.room);
  const myId = useStore((s) => s.auth.userId);
  const customPhrases = useStore((s) => s.prefs.quickPhrases);
  const phrases = customPhrases.length > 0 ? customPhrases : QUICK_PHRASES;
  const [text, setText] = useState('');
  const [stickersOpen, setStickersOpen] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat.length]);

  const avatarVersionOf = (userId: number) =>
    room?.players.find((p) => p.userId === userId)?.avatarVersion ?? 0;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    sendChat(text.trim());
    setText('');
  }

  return (
    <div
      className={cn(
        'flex h-full flex-col bg-white dark:bg-slate-900',
        chrome && 'rounded-2xl ring-1 ring-slate-200/70 dark:ring-slate-700/70',
      )}
    >
      {chrome && (
        <div className="border-b border-slate-100 px-4 py-3 font-display font-semibold dark:border-slate-800">
          Chat
        </div>
      )}
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {chat.length === 0 && (
          <p className="text-sm text-slate-400">Say hi. Messages are not saved.</p>
        )}
        {chat.map((m, i) => {
          const mine = m.userId === myId;
          return (
            <div key={i} className={cn('flex items-end gap-2', mine && 'flex-row-reverse')}>
              <Avatar
                userId={m.userId}
                name={m.from}
                version={avatarVersionOf(m.userId)}
                size="sm"
              />
              <div className={cn('max-w-[80%]', mine && 'text-right')}>
                <div className="text-xs text-slate-400">{m.from}</div>
                {m.kind === 'sticker' ? (
                  <div className="mt-0.5 text-4xl leading-none">{m.text}</div>
                ) : (
                  <div
                    className={cn(
                      'mt-0.5 inline-block rounded-2xl px-3 py-1.5 text-sm',
                      m.kind === 'phrase' &&
                        'border border-indigo-200 bg-indigo-50 font-medium text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950 dark:text-indigo-300',
                      m.kind === 'text' &&
                        (mine
                          ? 'bg-indigo-600 text-white'
                          : 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200'),
                    )}
                  >
                    {m.text}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      <div className="border-t border-slate-100 p-2 dark:border-slate-800">
        <div className="mb-2 flex flex-wrap gap-1.5 px-1">
          {phrases.map((p) => (
            <button
              key={p}
              onClick={() => sendChat(p, 'phrase')}
              className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-200 hover:text-slate-800 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-slate-100"
            >
              {p}
            </button>
          ))}
        </div>
        {stickersOpen && (
          <div className="mb-2 flex flex-wrap gap-1 px-1">
            {STICKERS.map((s) => (
              <button
                key={s}
                onClick={() => {
                  sendChat(s, 'sticker');
                  setStickersOpen(false);
                }}
                className="rounded-lg p-1.5 text-2xl hover:bg-slate-100 dark:hover:bg-slate-800"
                aria-label={`send ${s} sticker`}
              >
                {s}
              </button>
            ))}
          </div>
        )}
        <form onSubmit={submit} className="flex gap-2">
          <button
            type="button"
            onClick={() => setStickersOpen((v) => !v)}
            className="rounded-lg px-2 text-xl hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label="stickers"
          >
            <Smiley size={22} />
          </button>
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Message…"
            maxLength={500}
          />
          <Button type="submit" variant="secondary" disabled={!text.trim()}>
            Send
          </Button>
        </form>
      </div>
    </div>
  );
}
