import { api, mutate } from "../../_components/data";

const endpoint = "/api/v1/private-notes/scratchpad";
export type ScratchpadSnapshot = { body: string; revision: number };
type Draft = {
  body: string;
  saved: ScratchpadSnapshot;
  saving: boolean;
  reloading: boolean;
  error: string;
};

export function scratchpadPath(ownerId: string) {
  return `${endpoint}?${new URLSearchParams({ expectedOwnerId: ownerId })}`;
}

// Only pending drafts live beyond the editor. A clean editor always loads the
// latest saved notes when it mounts again.
const pending = new Map<string, ReturnType<typeof createDraft>>();

export function scratchpadDraft(ownerId: string, initial: ScratchpadSnapshot) {
  return pending.get(ownerId) ?? createDraft(ownerId, initial);
}

function createDraft(ownerId: string, initial: ScratchpadSnapshot) {
  let state: Draft = {
    body: initial.body,
    saved: initial,
    saving: false,
    reloading: false,
    error: "",
  };
  const listeners = new Set<() => void>();
  function update(changes: Partial<Draft>) {
    state = { ...state, ...changes };
    if (
      state.saving ||
      state.reloading ||
      state.error ||
      state.body !== state.saved.body
    ) {
      pending.set(ownerId, store);
    } else if (pending.get(ownerId) === store) {
      pending.delete(ownerId);
    }
    listeners.forEach((listener) => listener());
  }

  const store = {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    edit(body: string) {
      update({ body });
    },
    async flush() {
      if (
        state.saving ||
        state.reloading ||
        state.error ||
        state.body === state.saved.body
      )
        return;
      update({ saving: true });
      try {
        while (state.body !== state.saved.body) {
          const saved = await mutate<ScratchpadSnapshot>(
            endpoint,
            {
              body: state.body,
              expectedRevision: state.saved.revision,
              expectedOwnerId: ownerId,
            },
            "PATCH",
          );
          update({ saved });
        }
      } catch (failure) {
        update({
          error:
            failure instanceof Error
              ? failure.message
              : "Could not save your notes.",
        });
      } finally {
        update({ saving: false });
      }
    },
    retry() {
      update({ error: "" });
      void store.flush();
    },
    async discard() {
      if (state.saving || state.reloading) return;
      update({ reloading: true });
      try {
        const saved = await api<ScratchpadSnapshot>(scratchpadPath(ownerId));
        update({ body: saved.body, saved, error: "" });
      } catch (failure) {
        update({
          error:
            failure instanceof Error
              ? failure.message
              : "Could not load your saved notes.",
        });
      } finally {
        update({ reloading: false });
      }
    },
  };
  return store;
}
