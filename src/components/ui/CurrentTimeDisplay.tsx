import React, { useState, useEffect } from 'react';
import { format } from 'date-fns';
import '../../styles/CurrentTimeDisplay.css';

const CurrentTimeDisplay: React.FC = () => {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timerId = setInterval(() => {
      setTime(new Date());
    }, 60000); // Update every minute
    return () => clearInterval(timerId);
  }, []);

  return (
    <div className="current-time-display">
      {format(time, 'HH:mm')}
    </div>
  );
};

export default CurrentTimeDisplay;
