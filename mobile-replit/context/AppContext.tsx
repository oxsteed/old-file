import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useContext, useEffect, useState } from "react";

export interface PostedJob {
  id: string;
  title: string;
  category: string;
  description: string;
  budget: string;
  location: string;
  postedAt: string;
}

interface AppContextType {
  savedHelpers: string[];
  toggleSavedHelper: (id: string) => void;
  postedJobs: PostedJob[];
  addPostedJob: (job: PostedJob) => void;
  totalUnread: number;
}

const AppContext = createContext<AppContextType | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [savedHelpers, setSavedHelpers] = useState<string[]>([]);
  const [postedJobs, setPostedJobs] = useState<PostedJob[]>([]);

  useEffect(() => {
    AsyncStorage.getItem("oxsteed_saved").then((v) => {
      if (v) setSavedHelpers(JSON.parse(v));
    });
    AsyncStorage.getItem("oxsteed_posted_jobs").then((v) => {
      if (v) setPostedJobs(JSON.parse(v));
    });
  }, []);

  const toggleSavedHelper = (id: string) => {
    setSavedHelpers((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      AsyncStorage.setItem("oxsteed_saved", JSON.stringify(next));
      return next;
    });
  };

  const addPostedJob = (job: PostedJob) => {
    setPostedJobs((prev) => {
      const next = [job, ...prev];
      AsyncStorage.setItem("oxsteed_posted_jobs", JSON.stringify(next));
      return next;
    });
  };

  return (
    <AppContext.Provider value={{ savedHelpers, toggleSavedHelper, postedJobs, addPostedJob, totalUnread: 0 }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
