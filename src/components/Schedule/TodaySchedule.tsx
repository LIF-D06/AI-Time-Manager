import React, { useState, useEffect } from 'react';
import { getTasks, type Task } from '../../services/api';
import { format, startOfDay, endOfDay, parseISO } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { Calendar, Clock, MapPin, CheckCircle2, Circle } from 'lucide-react';
import '../../styles/Schedule.css';

const TodaySchedule: React.FC = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const fetchTodayTasks = async () => {
      setLoading(true);
      try {
        const today = new Date();
        const start = startOfDay(today).toISOString();
        const end = endOfDay(today).toISOString();
        const response = await getTasks({ start, end, limit: 100 });
        setTasks(response.tasks);
      } catch (error) {
        console.error('Failed to fetch tasks', error);
      } finally {
        setLoading(false);
      }
    };

    fetchTodayTasks();
  }, []);

  const getStatusColor = (task: Task) => {
    if (task.completed) return 'status-completed';
    const now = new Date();
    const start = parseISO(task.startTime);
    const end = parseISO(task.endTime);
    
    if (now >= start && now <= end) return 'status-active';
    if (now > end) return 'status-overdue';
    return 'status-upcoming';
  };

  return (
    <div className="schedule-container">
      <div className="schedule-header">
        <div>
          <h2>今日日程</h2>
          <p className="date-subtitle">{format(currentTime, 'yyyy年MM月dd日 EEEE', { locale: zhCN })}</p>
        </div>
        <div className="current-time">
          {format(currentTime, 'HH:mm')}
        </div>
      </div>

      <div className="timeline-view">
        {loading ? (
          <div className="loading-state">加载中...</div>
        ) : tasks.length === 0 ? (
          <div className="empty-state">
            <Calendar size={48} />
            <p>今天没有安排日程</p>
          </div>
        ) : (
          tasks.map((task) => (
            <div key={task.id} className={`timeline-item ${getStatusColor(task)}`}>
              <div className="time-column">
                <span className="start-time">{format(parseISO(task.startTime), 'HH:mm')}</span>
                <span className="duration">
                  {format(parseISO(task.endTime), 'HH:mm')}
                </span>
              </div>
              <div className="content-column">
                <div className="task-card">
                  <div className="task-header">
                    <h3>{task.name}</h3>
                    {task.completed ? <CheckCircle2 className="icon-completed" /> : <Circle className="icon-pending" />}
                  </div>
                  {task.description && <p className="task-desc">{task.description}</p>}
                  <div className="task-meta">
                    {task.location && (
                      <span className="meta-item">
                        <MapPin size={14} /> {task.location}
                      </span>
                    )}
                    <span className="meta-item">
                      <Clock size={14} /> {format(parseISO(task.startTime), 'HH:mm')} - {format(parseISO(task.endTime), 'HH:mm')}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default TodaySchedule;
