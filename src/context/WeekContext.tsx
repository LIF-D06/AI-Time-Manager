import React, { createContext, useContext, useEffect, useState } from 'react';
import { getWeekInfo, setUserWeek } from '../services/api';
import type { WeekInfoResponse } from '../services/api';

interface WeekContextValue {
  weekInfo: WeekInfoResponse | null;
  refreshWeek: () => Promise<void>;
  setCurrentWeek: (currentWeek: number) => Promise<WeekInfoResponse>;
}

const WeekContext = createContext<WeekContextValue | undefined>(undefined);

export const WeekProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [weekInfo, setWeekInfo] = useState<WeekInfoResponse | null>(null);

  const refreshWeek = async () => {
    try {
      const wi = await getWeekInfo();
      setWeekInfo(wi);
    } catch (e) {
      // ignore
    }
  };

  useEffect(() => {
    refreshWeek();
  }, []);

  const setCurrentWeek = async (currentWeek: number) => {
    const resp = await setUserWeek({ currentWeek });
    setWeekInfo(resp);
    return resp;
  };

  return (
    <WeekContext.Provider value={{ weekInfo, refreshWeek, setCurrentWeek }}>
      {children}
    </WeekContext.Provider>
  );
};

export const useWeek = () => {
  const ctx = useContext(WeekContext);
  if (!ctx) throw new Error('useWeek must be used within WeekProvider');
  return ctx;
};

export default WeekContext;
