import { useAuthedOnly } from "@/hooks/useAuthedOnly";
import type {
  Estimates,
  GameState,
  UseGameChannelProps,
  UserEstimate,
  Users,
} from "@/types/game";
import type { RealtimeChannel } from "@supabase/realtime-js";
import { nanoid } from "nanoid";
import { useSession } from "next-auth/react";
import type { NextRouter } from "next/router";
import { useRouter } from "next/router";
import type { Dispatch, SetStateAction } from "react";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";

import { subscribe, unsubscribeCallback } from "@/server/supabase";

const ESTIMATE_EVENT = "input";
const CLEAR_EVENT = "clear";
const VIEW_EVENT = "view";
const SYNC_EVENT = "sync";

const myId = nanoid();

const userValidator = z.object({
  id: z.string(),
  user: z.string(),
  image: z.string().url(),
});

const presenceValidator = z.array(userValidator);

export function useEstimationChannel(): UseGameChannelProps {
  useAuthedOnly((r) => {
    r.push("/auth?room=" + getChannelId(r)).then();
  });
  const channel = useRef<RealtimeChannel>();

  const { data: session, status } = useSession();
  const router = useRouter();

  const [channelId, setChannelId] = useState<string | undefined>(undefined);
  const [confetti, setConfetti] = useState(false);
  const [gameState, setGameState] = useState<GameState>("choosing");
  const [users, setUsers] = useState<Users>({});
  const [estimates, setEstimates] = useState<Estimates>({});

  useEffect(() => {
    if (channel.current) return unsubscribeCallback(channel.current);
    if (!router.isReady || !session?.user?.name || status != "authenticated")
      return;

    const channelId = getChannelId(router);
    setChannelId(channelId);

    channel.current = subscribe(channelId);
    channel.current
      .on("broadcast", { event: ESTIMATE_EVENT }, ({ payload }) => {
        addEstimate(payload, setEstimates);
      })
      .on("broadcast", { event: CLEAR_EVENT }, function () {
        _clearEstimates();
      })
      .on("broadcast", { event: VIEW_EVENT }, function () {
        setGameState("viewing");
      })
      .on("presence", { event: SYNC_EVENT }, () => {
        const state = channel.current?.presenceState();

        if (state && state[channelId] !== undefined) {
          presenceValidator
            .parseAsync(state[channelId])
            .then((r) => setUsers(Object.fromEntries(r.map((e) => [e.id, e]))));
        }
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.current?.track({
            user: session?.user?.name,
            image: session?.user?.image,
            id: myId,
          });
        }
      });
  }, [router, session?.user?.image, session?.user?.name, status]);

  useEffect(() => {
    updateGameState(estimates, users, setGameState);
    const estimatesCount = Object.keys(estimates).length;
    const usersCount = Object.keys(users).length;

    if (
      gameState == "choosing" ||
      gameState == "submitted" ||
      estimatesCount != usersCount ||
      estimatesCount == 0
    ) {
      setConfetti(false);
      return;
    }

    const arr = Object.values(estimates);
    setConfetti(arr.every((e) => e.value == (arr.at(0)?.value || "null")));
  }, [gameState, estimates, users]);

  function submitEstimate(value: string) {
    const estimate: UserEstimate = {
      value: value,
      user: {
        user: session?.user?.name || "Anonymous",
        image: session?.user?.image || "",
        id: myId,
      },
    };

    addEstimate(estimate, setEstimates);
    updateGameState(estimates, users, setGameState);
    if (gameState == "choosing") setGameState("submitted");
    channel.current?.send({
      type: "broadcast",
      event: ESTIMATE_EVENT,
      payload: estimate,
    });
  }

  function emitClear() {
    _clearEstimates();
    channel.current?.send({
      type: "broadcast",
      event: CLEAR_EVENT,
    });
  }

  function emitContinue() {
    setGameState("viewing");
    channel.current?.send({
      type: "broadcast",
      event: VIEW_EVENT,
    });
  }

  function _clearEstimates() {
    setEstimates({});
    setGameState("choosing");
  }

  return {
    myId: myId,
    room: channelId,
    onlineUsers: users,
    gameState: gameState,
    estimates: estimates,
    submit: submitEstimate,
    emitClear: emitClear,
    emitContinue: emitContinue,
    confetti: confetti,
  };
}

function addEstimate(
  estimate: UserEstimate,
  setEstimates: Dispatch<SetStateAction<Estimates>>
) {
  setEstimates((prevState) => ({
    ...prevState,
    [estimate.user.id]: estimate,
  }));
}

function updateGameState(
  estimates: Estimates,
  users: Users,
  setGameState: Dispatch<SetStateAction<GameState>>
) {
  const estimatesCount = Object.keys(estimates).length;
  const usersCount = Object.keys(users).length;

  if (estimatesCount && estimatesCount >= usersCount) setGameState("viewing");
}

const getChannelId = (r: NextRouter) => {
  return typeof r.query.room == "string"
    ? r.query.room
    : r.pathname.replace("/", "");
};
