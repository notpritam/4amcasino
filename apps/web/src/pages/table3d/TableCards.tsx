import { ArrowsOutSimple, CardsThree } from '@phosphor-icons/react';
import { PlayingCard } from '../../entities/card/PlayingCard.tsx';
import { useStore } from '../../shared/store.ts';
import { ShowdownCards } from '../../widgets/table/ShowdownCards.tsx';
import { publicCardsBySeat } from './publicTableCards.ts';

export function TableCards({
  onEnlarge,
  onResult,
}: {
  onEnlarge: () => void;
  onResult: () => void;
}) {
  const hand = useStore((s) => s.hand);
  const room = useStore((s) => s.room);
  const myId = useStore((s) => s.auth.userId);
  const mySeat = room?.players.find((p) => p.userId === myId)?.seat ?? null;
  const publicCards = publicCardsBySeat(hand);
  const boardRows = hand.board2.length ? [hand.board, hand.board2] : [hand.board];
  return (
    <section className="lounge-card-rail" aria-label="Cards on the table">
      <div className="lounge-card-line">
        <div className="community-cards" aria-label="Community cards">
          <span className="card-rail-label">
            {hand.board2.length ? 'Two runouts' : 'Community cards'}
          </span>
          {boardRows.map((board, row) => (
            <div className="community-run" key={row} aria-label={`Run ${row + 1}`}>
              {hand.board2.length > 0 && <span className="run-label">{row + 1}</span>}
              {Array.from({ length: 5 }, (_, index) =>
                board[index] === undefined ? (
                  <span
                    key={index}
                    className="community-slot"
                    aria-label={`Empty community card ${index + 1}`}
                  />
                ) : (
                  <PlayingCard
                    key={`${index}-${board[index]}`}
                    card={board[index]}
                    size="sm"
                    deal
                  />
                ),
              )}
            </div>
          ))}
        </div>
        {mySeat !== null && hand.myCards.length > 0 && (
          <button
            className="private-hand card-enlarge"
            onClick={onEnlarge}
            aria-label="Enlarge your cards"
          >
            <span className="card-rail-label">
              Your cards <ArrowsOutSimple size={12} />
            </span>
            <span className="private-cards">
              {hand.myCards.map((card, i) => (
                <PlayingCard key={`${i}-${card}`} card={card} size="sm" />
              ))}
            </span>
          </button>
        )}
        {(hand.result || hand.abort) && (
          <button className="lounge-button hand-result-trigger" onClick={onResult}>
            <CardsThree size={17} />
            <span>Hand result</span>
          </button>
        )}
      </div>
      {Object.keys(publicCards).length > 0 && (
        <div className="lounge-public-cards" aria-label="Publicly shown cards">
          <span className="card-rail-label">Shown to everyone</span>
          <ShowdownCards
            reveals={hand.showdown?.reveals ?? []}
            shown={hand.shown}
            deltas={hand.result?.deltas ?? []}
            nameOf={(seat) =>
              room?.players.find((p) => p.seat === seat)?.displayName ??
              hand.seats.find((p) => p.seat === seat)?.username ??
              `Seat ${seat + 1}`
            }
            light
          />
        </div>
      )}
    </section>
  );
}
