import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import { getMyInterviewRoom, getTeamInterviewRoom } from '../api/careers';
import { Loading, LoadError, Notice, useLoad } from '../components/careers/ui';
import { useSocket } from '../hooks/useSocket';
import { formatWhen } from '../features/careers/careersModel';
import '../styles/CareerSystem.css';

function RemoteVideo({ stream }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream; }, [stream]);
  return <video ref={ref} className="ox-careers-video" autoPlay playsInline />;
}

/**
 * In-house interview video room. Media is peer-to-peer WebRTC (mesh, at
 * most 4 people); the /chat socket only relays offers, answers and ICE
 * between sockets the server admitted to this interview. Nothing is
 * recorded.
 */
export default function CareerInterviewRoomPage() {
  const { t, i18n } = useTranslation();
  const { id } = useParams();
  const [params] = useSearchParams();
  const applicationId = params.get('application');
  const team = params.get('side') === 'team';
  const navigate = useNavigate();
  const { socket, connected } = useSocket();
  const info = useLoad(() => (team ? getTeamInterviewRoom(applicationId, id) : getMyInterviewRoom(applicationId, id)), [applicationId, id, team]);
  const [phase, setPhase] = useState('lobby'); // lobby | joining | live | left | error
  const [error, setError] = useState('');
  const [remotes, setRemotes] = useState({}); // peerId -> MediaStream
  const [mic, setMic] = useState(true);
  const [cam, setCam] = useState(true);
  const localRef = useRef(null);
  const localStream = useRef(null);
  const peers = useRef(new Map());

  const iceServers = info.data?.ice_servers || [];
  const signal = useCallback((to, type, payload) => socket?.emit('careers:room:signal', { interviewId: Number(id), to, type, payload }), [socket, id]);

  const dropPeer = useCallback((peerId) => {
    const pc = peers.current.get(peerId);
    if (pc) { pc.close(); peers.current.delete(peerId); }
    setRemotes((r) => { const n = { ...r }; delete n[peerId]; return n; });
  }, []);

  const makePeer = useCallback((peerId) => {
    if (peers.current.has(peerId)) return peers.current.get(peerId);
    const pc = new RTCPeerConnection({ iceServers });
    localStream.current?.getTracks().forEach((track) => pc.addTrack(track, localStream.current));
    pc.onicecandidate = (e) => { if (e.candidate) signal(peerId, 'ice', e.candidate.toJSON()); };
    pc.ontrack = (e) => setRemotes((r) => ({ ...r, [peerId]: e.streams[0] }));
    pc.onconnectionstatechange = () => { if (['failed', 'closed'].includes(pc.connectionState)) dropPeer(peerId); };
    peers.current.set(peerId, pc);
    return pc;
  }, [iceServers, signal, dropPeer]);

  useEffect(() => {
    if (!socket) return undefined;
    const onSignal = async (msg) => {
      if (Number(msg?.interviewId) !== Number(id)) return;
      try {
        if (msg.type === 'bye') { dropPeer(msg.from); return; }
        const pc = makePeer(msg.from);
        if (msg.type === 'offer') {
          await pc.setRemoteDescription(msg.payload);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          signal(msg.from, 'answer', pc.localDescription.toJSON());
        } else if (msg.type === 'answer') {
          await pc.setRemoteDescription(msg.payload);
        } else if (msg.type === 'ice' && msg.payload) {
          await pc.addIceCandidate(msg.payload);
        }
      } catch { /* a bad signal only affects that peer */ }
    };
    const onPeer = (evt) => { if (Number(evt?.interviewId) === Number(id) && evt.event === 'left') dropPeer(evt.peerId); };
    socket.on('careers:room:signal', onSignal);
    socket.on('careers:room:peer', onPeer);
    return () => { socket.off('careers:room:signal', onSignal); socket.off('careers:room:peer', onPeer); };
  }, [socket, id, makePeer, signal, dropPeer]);

  const leave = useCallback(() => {
    for (const peerId of peers.current.keys()) signal(peerId, 'bye', null);
    for (const peerId of [...peers.current.keys()]) dropPeer(peerId);
    socket?.emit('careers:room:leave', Number(id));
    localStream.current?.getTracks().forEach((track) => track.stop());
    localStream.current = null;
    setPhase('left');
  }, [socket, id, signal, dropPeer]);

  useEffect(() => () => { if (localStream.current) leave(); }, [leave]);

  const join = async () => {
    setPhase('joining'); setError('');
    try {
      localStream.current = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      if (localRef.current) localRef.current.srcObject = localStream.current;
    } catch {
      setPhase('error'); setError(t('careers.mk.room.noDevices')); return;
    }
    socket.emit('careers:room:join', Number(id), async (ack) => {
      if (!ack?.ok) { setPhase('error'); setError(t(ack?.error === 'room_full' ? 'careers.mk.room.full' : 'careers.mk.room.notAvailable')); return; }
      setPhase('live');
      for (const peerId of ack.peers || []) {
        const pc = makePeer(peerId);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        signal(peerId, 'offer', pc.localDescription.toJSON());
      }
    });
  };
  const toggle = (kind) => {
    const tracks = kind === 'audio' ? localStream.current?.getAudioTracks() : localStream.current?.getVideoTracks();
    const next = kind === 'audio' ? !mic : !cam;
    tracks?.forEach((track) => { track.enabled = next; });
    if (kind === 'audio') setMic(next); else setCam(next);
  };

  const r = info.data;
  return (
    <PageShell>
      <PageMeta title={t('careers.mk.room.title')} description={t('careers.mk.room.title')} />
      <div className="ox-careers">
        <button type="button" className="ox-careers-btn" onClick={() => (team ? navigate(-1) : navigate('/careers/me?tab=tracker'))}>{t('careers.back')}</button>
        <h1>{t('careers.mk.room.title')}</h1>
        {info.loading && !r ? <Loading /> : null}
        <LoadError error={info.error} onRetry={info.reload} />
        {r ? (
          <>
            <p className="ox-careers-lead">{r.title} · {r.employer_name}</p>
            <Notice>{t('careers.mk.room.privacy')}</Notice>
            {!r.open ? <Notice tone="warn">{t('careers.mk.room.notOpen', { when: formatWhen(r.opens_at, undefined, i18n.language) })}</Notice> : null}
            {error ? <Notice tone="error">{error}</Notice> : null}
            <div className="ox-careers-video-grid">
              <video ref={localRef} className="ox-careers-video mine" autoPlay playsInline muted aria-label={t('careers.mk.room.you')} />
              {Object.entries(remotes).map(([peerId, stream]) => <RemoteVideo key={peerId} stream={stream} />)}
            </div>
            {phase === 'live' && !Object.keys(remotes).length ? <p className="ox-careers-subtle" aria-live="polite">{t('careers.mk.room.waiting')}</p> : null}
            <div className="ox-careers-actions">
              {phase === 'lobby' || phase === 'error' || phase === 'left'
                ? <button type="button" className="ox-careers-btn primary" disabled={!r.open || !connected} onClick={join}>{t('careers.mk.room.join')}</button>
                : null}
              {phase === 'live' ? (
                <>
                  <button type="button" className="ox-careers-btn" aria-pressed={!mic} onClick={() => toggle('audio')}>{mic ? t('careers.mk.room.mute') : t('careers.mk.room.unmute')}</button>
                  <button type="button" className="ox-careers-btn" aria-pressed={!cam} onClick={() => toggle('video')}>{cam ? t('careers.mk.room.cameraOff') : t('careers.mk.room.cameraOn')}</button>
                  <button type="button" className="ox-careers-btn danger" onClick={leave}>{t('careers.mk.room.leave')}</button>
                </>
              ) : null}
            </div>
            {!connected ? <p className="ox-careers-subtle">{t('careers.mk.room.connecting')}</p> : null}
          </>
        ) : null}
      </div>
    </PageShell>
  );
}
