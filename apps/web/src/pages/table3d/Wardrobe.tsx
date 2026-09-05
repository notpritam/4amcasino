import { useRef, useState } from 'react';
import { Check, Shuffle, X } from '@phosphor-icons/react';
import { api } from '../../shared/api.ts';
import { useStore } from '../../shared/store.ts';
import { CharacterPreview } from './CharacterPreview.tsx';
import { COLORS, FX, HATS, HEADS, PRESETS, parseAvatar, type Avatar3D } from './avatar.ts';

export function Wardrobe({ initial, onClose }: { initial: Avatar3D; onClose(): void }) {
  const [draft, setDraft] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const saving = useRef(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const update = (next: Avatar3D) => {
    setDraft(next);
    setMessage('');
    setError('');
  };
  const save = async () => {
    if (saving.current) return;
    const savingUserId = useStore.getState().auth.userId;
    saving.current = true;
    setBusy(true);
    setMessage('');
    setError('');
    try {
      await api.updateProfile({ avatar3d: JSON.stringify(draft) });
      const store = useStore.getState();
      // Update the local character immediately; room broadcasts reconcile other clients.
      if (store.room && store.auth.userId === savingUserId)
        store.setRoom({
          ...store.room,
          players: store.room.players.map((p) =>
            p.userId === store.auth.userId ? { ...p, avatar3d: JSON.stringify(draft) } : p,
          ),
        });
      setSaved(draft);
      setMessage('Saved. Your character is ready for the table.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save. Please try again.');
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  const shuffle = () => {
    const pick = <T,>(items: T[]): T => items[Math.floor(Math.random() * items.length)]!;
    update({
      c: pick(COLORS).value,
      t: pick(COLORS).value,
      head: pick(HEADS),
      hat: pick(HATS),
      fx: pick(FX),
    });
  };
  return (
    <section className="lounge-panel wardrobe" aria-label="Character studio">
      <div className="panel-heading">
        <div>
          <h2>Your character</h2>
          <p>A little more you at the table.</p>
        </div>
        <button
          autoFocus
          className="lounge-icon"
          aria-label="Close character studio"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      <CharacterPreview cfg={draft} />
      <div className="wardrobe-scroll">
        <div className="wardrobe-section">
          <div className="field-heading">
            <h3>Make it yours</h3>
            <button className="text-button" onClick={shuffle} disabled={busy}>
              <Shuffle size={14} /> Shuffle
            </button>
          </div>
          <div className="preset-grid">
            {PRESETS.map((preset) => (
              <button
                key={preset.name}
                disabled={busy}
                aria-pressed={JSON.stringify(draft) === JSON.stringify(preset.cfg)}
                onClick={() => update(preset.cfg)}
              >
                <span className="preset-colors">
                  <i style={{ background: preset.cfg.c }} />
                  <i style={{ background: preset.cfg.t }} />
                </span>
                {preset.name}
              </button>
            ))}
          </div>
        </div>
        {(['c', 't'] as const).map((field) => (
          <fieldset key={field} className="wardrobe-section" disabled={busy}>
            <legend>{field === 'c' ? 'Suit color' : 'Light color'}</legend>
            <div className="swatches">
              {COLORS.map(({ value, name }) => (
                <button
                  key={value}
                  className="color-swatch"
                  title={name}
                  aria-label={`${field === 'c' ? 'Suit' : 'Light'} color ${name}`}
                  aria-pressed={draft[field] === value}
                  style={{ background: value }}
                  onClick={() => update({ ...draft, [field]: value })}
                >
                  {draft[field] === value && <Check size={16} weight="bold" />}
                </button>
              ))}
            </div>
          </fieldset>
        ))}
        <fieldset className="wardrobe-section" disabled={busy}>
          <legend>Silhouette</legend>
          <div className="segment-control">
            {HEADS.map((head) => (
              <button
                key={head}
                aria-pressed={draft.head === head}
                onClick={() => update({ ...draft, head })}
              >
                {{ round: 'Orbit', cube: 'Block', cone: 'Comet' }[head]}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="wardrobe-section" disabled={busy}>
          <legend>Headwear</legend>
          <div className="segment-control">
            {HATS.map((hat) => (
              <button
                key={hat}
                aria-pressed={draft.hat === hat}
                onClick={() => update({ ...draft, hat })}
              >
                {hat === 'none' ? 'None' : hat}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="wardrobe-section" disabled={busy}>
          <legend>Exit effect</legend>
          <div className="segment-control">
            {FX.map((fx) => (
              <button
                key={fx}
                aria-pressed={draft.fx === fx}
                onClick={() => update({ ...draft, fx })}
              >
                {fx}
              </button>
            ))}
          </div>
          <p className="field-hint">Your send-off when your stack reaches zero.</p>
        </fieldset>
      </div>
      <div className="wardrobe-footer">
        {error && (
          <p className="lounge-error" role="alert">
            Couldn’t save: {error} Try again.
          </p>
        )}
        {message && (
          <p className="save-feedback" role="status">
            <Check size={15} />
            {message}
          </p>
        )}
        <div className="wardrobe-actions">
          <button
            className="lounge-button"
            disabled={!dirty || busy}
            onClick={() => update(parseAvatar(JSON.stringify(saved)))}
          >
            Reset
          </button>
          <button
            className="lounge-button primary"
            disabled={!dirty || busy}
            onClick={() => void save()}
          >
            {busy ? 'Saving…' : message ? 'Saved' : 'Save character'}
          </button>
        </div>
        <p className="field-hint">
          {dirty
            ? 'Unsaved changes. Save to wear this at the table.'
            : 'Seen by everyone at your table.'}
        </p>
      </div>
    </section>
  );
}
