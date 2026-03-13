import { useCallback, useEffect, useRef, useState } from "react";
import type { RunningState, StandupState } from "./useWebsocket";
import type { Participant, User } from "./useDiscordSdk";
import { ParticipantAvatar } from "./ParticipantAvatar";

interface StandupProps {
  participants: Participant[];
  standupState: RunningState;
  setStandupState: (state: StandupState) => void;
  currentUser: User;
  websocket: WebSocket | null;
}

export function Standup({
  participants,
  standupState,
  setStandupState,
  currentUser,
  websocket,
}: StandupProps) {
  const [localOffset, setLocalOffset] = useState<number>(
    standupState.currentOffset
  );
  const lastTick = useRef<number>(Date.now());
  const timeout = useRef<number | null>(null);

  useEffect(() => {
    if (timeout.current != null) {
      clearTimeout(timeout.current);
    }

    lastTick.current = Date.now();
    setLocalOffset(standupState.currentOffset);
  }, [standupState]);

  useEffect(() => {
    if (timeout.current != null) {
      clearTimeout(timeout.current);
    }

    if (standupState.isPaused) return;

    timeout.current = setTimeout(() => {
      const nextTick = Date.now();
      setLocalOffset(localOffset + (nextTick - lastTick.current));
      lastTick.current = nextTick;
    }, 250);
  }, [localOffset, standupState.isPaused, standupState.pausedAt]);

  const durationMs = standupState.duration * 1000;
  const currentIndex = Math.floor(localOffset / durationMs);
  const currentSpeakerId = standupState.members[currentIndex];
  const currentSpeakerTimeElapsed = localOffset - currentIndex * durationMs;
  const currentSpeaker = participants.find((p) => p.id === currentSpeakerId);

  useEffect(() => {
    if (
      (localOffset > 0 && currentSpeaker == null) ||
      currentIndex >= standupState.members.length
    ) {
      setStandupState({
        type: "completed",
      });
    }
  }, [
    currentSpeaker,
    currentIndex,
    standupState.members.length,
    localOffset,
    setStandupState,
  ]);

  const pause = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      websocket?.send(
        JSON.stringify({
          type: "pause",
        })
      );
    },
    [websocket]
  );

  const resume = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      websocket?.send(
        JSON.stringify({
          type: "resume",
        })
      );
    },
    [websocket]
  );

  const skip = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      websocket?.send(
        JSON.stringify({
          type: "skip",
        })
      );
    },
    [websocket]
  );

  const currentSpeakerName =
    currentSpeaker?.nickname ??
    currentSpeaker?.global_name ??
    currentSpeaker?.username ??
    "Someone stinky";

  const nextSpeaker = participants.find(
    (p) => p.id === standupState.members[currentIndex + 1]
  );
  const nextSpeakerName =
    nextSpeaker?.nickname ?? nextSpeaker?.global_name ?? nextSpeaker?.username;

  if (localOffset <= 0) {
    return (
      <div className="countdownScreen">
        <h1 className="countdownScreen__title">Starting in</h1>
        <div className="countdownScreen__countdown">
          {Math.ceil(Math.abs(localOffset) / 1000)}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="standup__wtf">
        <h1>Hey! Are you paying attention?</h1>
      </div>
      <div className="standup">
        <div className="standup__activeContainer">
          <h1>
            {currentUser.id === currentSpeakerId
              ? "You're up!"
              : `${currentSpeakerName}`}
          </h1>
          {currentSpeaker != null ? (
            <ParticipantAvatar participant={currentSpeaker} size={128} />
          ) : null}
          <div key={currentSpeakerId}>
            {standupState.isPaused ? (
              <div className="standup__pausedText">PAUSED!</div>
            ) : (
              <div className="standup__progress">
                <div className="standup__progressText">
                  <span>
                    {Math.ceil((durationMs - currentSpeakerTimeElapsed) / 1000)}
                  </span>
                </div>
                <div
                  className="standup__progressFill"
                  style={{
                    width: `${
                      (currentSpeakerTimeElapsed / (durationMs - 1000)) * 100
                    }%`,
                  }}
                ></div>
              </div>
            )}
          </div>
          <div className="standup__controls">
            {!standupState.isPaused ? (
              <button className="standup__controlButton" onClick={pause}>
                Pause
              </button>
            ) : (
              <button className="standup__controlButton" onClick={resume}>
                Resume
              </button>
            )}
            <button className="standup__controlButton" onClick={skip}>
              Skip
            </button>
          </div>
        </div>
        {nextSpeaker != null ? (
          <div className="standup__nextSpeaker">
            <span>Next up: {nextSpeakerName}</span>
            <ParticipantAvatar participant={nextSpeaker} size={32} />
          </div>
        ) : null}
        <img src="burgyPopcorn.png" width={128} className="standup__friend" />
      </div>
    </>
  );
}
