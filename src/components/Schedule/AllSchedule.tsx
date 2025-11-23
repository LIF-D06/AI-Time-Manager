import React, { useState, useEffect } from 'react';
import { getTasks, type Task } from '../../services/api';
import { format, startOfWeek, endOfWeek, addDays, startOfMonth, endOfMonth, isSameMonth, isSameDay, parseISO, addMonths, subMonths } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, List } from 'lucide-react';
import '../../styles/Schedule.css';

const AllSchedule: React.FC = () => {
  const [viewMode, setViewMode] = useState<'month' | 'week'>('month');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchTasks = async () => {
    setLoading(true);
    try {
      let start, end;
      if (viewMode === 'month') {
        start = startOfMonth(currentDate).toISOString();
        end = endOfMonth(currentDate).toISOString();
      } else {
        start = startOfWeek(currentDate, { weekStartsOn: 1 }).toISOString();
        end = endOfWeek(currentDate, { weekStartsOn: 1 }).toISOString();
      }
      
      const response = await getTasks({ start, end, limit: 500 });
      setTasks(response.tasks);
    } catch (error) {
      console.error('Failed to fetch tasks', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks();
  }, [currentDate, viewMode]);

  const navigate = (direction: 'prev' | 'next') => {
    if (viewMode === 'month') {
      setCurrentDate(d => direction === 'prev' ? subMonths(d, 1) : addMonths(d, 1));
    } else {
      setCurrentDate(d => direction === 'prev' ? addDays(d, -7) : addDays(d, 7));
    }
  };

  const renderMonthView = () => {
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(monthStart);
    const startDate = startOfWeek(monthStart, { weekStartsOn: 1 });
    const endDate = endOfWeek(monthEnd, { weekStartsOn: 1 });

    const rows = [];
    let days = [];
    let day = startDate;
    let formattedDate = '';

    while (day <= endDate) {
      for (let i = 0; i < 7; i++) {
        formattedDate = format(day, 'd');
        const cloneDay = day;
        const dayTasks = tasks.filter(t => isSameDay(parseISO(t.startTime), cloneDay));
        
        days.push(
          <div
            className={`calendar-day ${!isSameMonth(day, monthStart) ? 'disabled' : ''} ${isSameDay(day, new Date()) ? 'today' : ''}`}
            key={day.toString()}
          >
            <span className="day-number">{formattedDate}</span>
            <div className="day-tasks">
              {dayTasks.slice(0, 3).map(task => (
                <div key={task.id} className="mini-task" title={task.name}>
                  <span className="task-dot"></span>
                  {task.name}
                </div>
              ))}
              {dayTasks.length > 3 && (
                <div className="more-tasks">+{dayTasks.length - 3} 更多</div>
              )}
            </div>
          </div>
        );
        day = addDays(day, 1);
      }
      rows.push(
        <div className="calendar-row" key={day.toString()}>
          {days}
        </div>
      );
      days = [];
    }
    return <div className="calendar-body">{rows}</div>;
  };

  return (
    <div className="schedule-container">
      <div className="schedule-header">
        <div className="header-left">
          <h2>全部日程</h2>
          <div className="view-controls">
            <button 
              className={viewMode === 'month' ? 'active' : ''} 
              onClick={() => setViewMode('month')}
            >
              <CalendarIcon size={16} /> 月视图
            </button>
            <button 
              className={viewMode === 'week' ? 'active' : ''} 
              onClick={() => setViewMode('week')}
            >
              <List size={16} /> 周视图
            </button>
          </div>
        </div>
        
        <div className="date-navigation">
          <button onClick={() => navigate('prev')}><ChevronLeft /></button>
          <span className="current-date-label">
            {format(currentDate, 'yyyy年MM月', { locale: zhCN })}
          </span>
          <button onClick={() => navigate('next')}><ChevronRight /></button>
        </div>
      </div>

      <div className="calendar-view">
        <div className="calendar-header">
          {['一', '二', '三', '四', '五', '六', '日'].map(d => (
            <div key={d} className="week-day">{d}</div>
          ))}
        </div>
        {loading ? <div className="loading-overlay">加载中...</div> : renderMonthView()}
      </div>
    </div>
  );
};

export default AllSchedule;
