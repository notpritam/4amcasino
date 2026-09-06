import { useEffect, useRef, useState, type RefObject } from 'react';
import {
  ArrowsOutSimple,
  FolderOpen,
  Pause,
  Play,
  SpeakerHigh,
  SpeakerSlash,
  X,
} from '@phosphor-icons/react';

export function LoungeTV({
  open,
  onClose,
  videoRef,
  channel,
  onChannel,
}: {
  open: boolean;
  onClose: () => void;
  videoRef: RefObject<HTMLVideoElement>;
  channel: 'film' | 'table';
  onChannel: (channel: 'film' | 'table') => void;
}) {
  const [source, setSource] = useState('/media/lounge-after-hours.mp4');
  const [title, setTitle] = useState('After Hours');
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [volume, setVolume] = useState(0.35);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const fileUrl = useRef<string>();
  const resumeAfterHidden = useRef(false);
  const resumeAfterChannel = useRef(false);
  const channelRef = useRef(channel);
  channelRef.current = channel;
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const reduced = useRef(matchMedia('(prefers-reduced-motion: reduce)').matches);
  const formatTime = (seconds: number) =>
    `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
  const playVideo = () => {
    setError('');
    void videoRef.current
      ?.play()
      .catch(() => setError('Playback paused. Press Play to try again.'));
  };
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    // StrictMode runs setup again after cleanup without reapplying unchanged
    // JSX attributes. Restore the source that cleanup released before loading.
    if (!video.getAttribute('src')) {
      video.src = sourceRef.current;
      video.load();
      if (!reduced.current && channelRef.current === 'film' && !document.hidden) {
        void video.play().catch(() => {});
      }
    }
    const visibility = () => {
      if (document.hidden) {
        resumeAfterHidden.current = !video.paused;
        video.pause();
      } else if (resumeAfterHidden.current && channelRef.current === 'film') {
        resumeAfterHidden.current = false;
        void video.play().catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      video.pause();
      video.removeAttribute('src');
      video.load();
      if (fileUrl.current) URL.revokeObjectURL(fileUrl.current);
    };
  }, [videoRef]);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (channel === 'table') {
      resumeAfterChannel.current = !video.paused || resumeAfterHidden.current;
      resumeAfterHidden.current = false;
      video.pause();
    } else if (resumeAfterChannel.current) {
      resumeAfterChannel.current = false;
      if (document.hidden) resumeAfterHidden.current = true;
      else void video.play().catch(() => {});
    }
  }, [channel, videoRef]);
  return (
    <section
      className="lounge-panel lounge-tv-panel"
      aria-label="Lounge TV controls"
      hidden={!open}
    >
      <div className="panel-heading">
        <div>
          <h2>Lounge TV</h2>
          <p>Your playback on this device.</p>
        </div>
        <button className="lounge-icon" aria-label="Close TV controls" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <div className="tv-channels" aria-label="TV channel">
        <button aria-pressed={channel === 'film'} onClick={() => onChannel('film')}>
          Video
        </button>
        <button aria-pressed={channel === 'table'} onClick={() => onChannel('table')}>
          Table live
        </button>
      </div>
      <video
        ref={videoRef}
        src={source}
        poster="/media/lounge-after-hours.webp"
        playsInline
        loop
        muted={muted}
        autoPlay={!reduced.current}
        preload="metadata"
        className={channel === 'table' ? 'tv-video-hidden' : ''}
        aria-label={title}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onLoadedMetadata={(event) => {
          const video = event.currentTarget;
          setDuration(Number.isFinite(video.duration) ? video.duration : 0);
          setTime(0);
          setError('');
          video.volume = volume;
        }}
        onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
        onError={() =>
          setError('This video could not play. Try an MP4 or restore the lounge film.')
        }
      />
      {channel === 'table' ? (
        <p className="tv-description">
          The screen shows the current pot, board, and whose turn it is. Private cards stay private.
        </p>
      ) : (
        <>
          <div className="tv-track">
            <strong>{title}</strong>
            <span>{fileUrl.current ? 'Local file' : 'Silent ambient loop'}</span>
          </div>
          <label className="tv-seek">
            <span className="sr-only">Video position</span>
            <input
              type="range"
              min={0}
              max={duration || 1}
              step={0.1}
              value={Math.min(time, duration || 1)}
              disabled={!duration}
              onChange={(event) => {
                const next = +event.target.value;
                setTime(next);
                if (videoRef.current) videoRef.current.currentTime = next;
              }}
            />
            <span>
              {formatTime(time)} / {formatTime(duration)}
            </span>
          </label>
          <div className="tv-playback">
            <button
              className="lounge-button"
              aria-label={playing ? 'Pause TV' : 'Play TV'}
              onClick={() => (playing ? videoRef.current?.pause() : playVideo())}
            >
              {playing ? <Pause size={18} /> : <Play size={18} />}
              {playing ? 'Pause' : 'Play'}
            </button>
            <button
              className="lounge-icon"
              aria-label={muted ? 'Unmute TV' : 'Mute TV'}
              onClick={() => setMuted(!muted)}
            >
              {muted ? <SpeakerSlash size={18} /> : <SpeakerHigh size={18} />}
            </button>
            <input
              type="range"
              aria-label="TV volume"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              onChange={(event) => {
                const next = +event.target.value;
                setVolume(next);
                setMuted(next === 0);
                if (videoRef.current) videoRef.current.volume = next;
              }}
            />
            <button
              className="lounge-icon"
              aria-label="Fullscreen video"
              onClick={() => {
                void videoRef.current
                  ?.requestFullscreen?.()
                  .catch(() => setError('Fullscreen is unavailable in this browser.'));
              }}
            >
              <ArrowsOutSimple size={18} />
            </button>
          </div>
        </>
      )}
      {error && (
        <p className="tv-error" role="alert">
          {error}
        </p>
      )}
      <div className="tv-files">
        <input
          ref={fileRef}
          type="file"
          accept="video/*"
          className="sr-only"
          aria-label="Choose a local video"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            videoRef.current?.pause();
            if (fileUrl.current) URL.revokeObjectURL(fileUrl.current);
            fileUrl.current = URL.createObjectURL(file);
            setSource(fileUrl.current);
            setTitle(file.name);
            setError('');
            setDuration(0);
            setTime(0);
            onChannel('film');
            event.target.value = '';
          }}
        />
        <button className="lounge-button" onClick={() => fileRef.current?.click()}>
          <FolderOpen size={17} />
          Open video
        </button>
        <button
          className="lounge-button"
          onClick={() => {
            videoRef.current?.pause();
            if (fileUrl.current) URL.revokeObjectURL(fileUrl.current);
            fileUrl.current = undefined;
            setSource('/media/lounge-after-hours.mp4');
            setTitle('After Hours');
            setError('');
            onChannel('film');
            videoRef.current?.load();
          }}
        >
          Lounge film
        </button>
      </div>
      <p className="tv-description">
        Local videos stay on your device. Opening this panel keeps the table and your game controls
        available.
      </p>
    </section>
  );
}
