import { create } from "zustand";

export type JobDraft = {
  title: string;
  description: string;
  category: string;
  budgetMin: string;
  budgetMax: string;
};

type JobDraftState = {
  draft: JobDraft | null;
  setDraft: (draft: JobDraft) => void;
  clearDraft: () => void;
};

export const useJobDraftStore = create<JobDraftState>((set) => ({
  draft: null,
  setDraft: (draft) => set({ draft }),
  clearDraft: () => set({ draft: null })
}));
