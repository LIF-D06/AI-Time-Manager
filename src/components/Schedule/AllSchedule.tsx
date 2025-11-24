import React, { useState, useEffect } from 'react';
import { getTasks, type Task } from '../../services/api';
import { format, startOfWeek, endOfWeek, addDays, startOfMonth, endOfMonth, isSameMonth, isSameDay, parseISO, addMonths, subMonths } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, List, Plus } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import { Button } from '../ui/Button';
import AddTaskModal from './AddTaskModal';
import TaskDetailModal from './TaskDetailModal';
import '../../styles/Schedule.css';

const AllSchedule: React.FC = () => {
  const [viewMode, setViewMode] = useState<'month' | 'week'>(window.innerWidth < 768 ? 'week' : 'month');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

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

  const navigate = (direction: 'prev' | 'next' | 'today') => {
    if (direction === 'today') {
      setCurrentDate(new Date());
      return;
    }
    if (viewMode === 'month') {
      setCurrentDate(d => direction === 'prev' ? subMonths(d, 1) : addMonths(d, 1));
    } else {
      setCurrentDate(d => direction === 'prev' ? addDays(d, -7) : addDays(d, 7));
    }
  };

  const renderWeekView = () => {
    const startDate = startOfWeek(currentDate, { weekStartsOn: 1 });
    const weekDays = Array.from({ length: 7 }).map((_, i) => addDays(startDate, i));

    return (
      <div className="week-view-layout">
        <div className="week-view-header">
          <div className="time-axis-header"></div>
          {weekDays.map(day => (
            <div key={day.toString()} className={`week-header-day ${isSameDay(day, new Date()) ? 'today' : ''}`}>
              <div className="week-day-name">{format(day, 'EEE', { locale: zhCN })}</div>
              <div className="week-day-date">{format(day, 'd')}</div>
            </div>
          ))}
        </div>
        <div className="week-view-body">
          <div className="time-axis">
            {Array.from({ length: 24 }).map((_, i) => (
              <div key={i} className="time-label" style={{ top: `${i * 60}px` }}>
                <span>{i}:00</span>
              </div>
            ))}
          </div>
          <div className="week-grid">
            {/* Horizontal Grid Lines */}
            {Array.from({ length: 24 }).map((_, i) => (
              <div key={i} className="grid-line-horizontal" style={{ top: `${i * 60}px` }}></div>
            ))}
            
            {/* Day Columns */}
            {weekDays.map(day => {
              const dayTasks = tasks.filter(t => isSameDay(parseISO(t.startTime), day));
              const isToday = isSameDay(day, new Date());
              
              return (
                <div key={day.toString()} className={`day-column ${isToday ? 'today-column' : ''}`}>
                  {dayTasks.map(task => {
                    const start = parseISO(task.startTime);
                    const end = parseISO(task.endTime);
                    const startMinutes = start.getHours() * 60 + start.getMinutes();
                    const durationMinutes = (end.getTime() - start.getTime()) / (1000 * 60);
                    const taskHeight = Math.max(durationMinutes - 3, 28);
                    
                    return (
                      <div
                        key={task.id}
                        className={`mini-task absolute-task importance-${task.importance || 'normal'} ${task.completed ? 'task-completed' : ''} ${taskHeight < 40 ? 'compact-task' : ''}`}
                        style={{
                          top: `${startMinutes}px`,
                          height: `${taskHeight}px`,
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedTask(task);
                        }}
                        title={`${task.name}${task.description ? '\n' + task.description : ''}\n${format(start, 'HH:mm')} - ${format(end, 'HH:mm')}`}
                      >
                        <div className="task-content-wrapper">
                           <span className="task-name">{task.name}</span>
                           {task.description && durationMinutes > 30 && (
                             <span className="task-description">{task.description}</span>
                           )}
                           {durationMinutes > 20 && <span className="task-time-label">{format(start, 'HH:mm')}</span>}
                        </div>
                      </div>
                    );
                  })}
                  
                  {/* Current Time Line if today */}
                  {isToday && (
                     <div 
                       className="current-time-marker-line"
                       style={{ top: `${currentTime.getHours() * 60 + currentTime.getMinutes()}px` }}
                     >
                       <div className="marker-dot"></div>
                     </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  const renderCalendar = () => {
    let startDate, endDate;
    
    if (viewMode === 'month') {
      const monthStart = startOfMonth(currentDate);
      const monthEnd = endOfMonth(monthStart);
      startDate = startOfWeek(monthStart, { weekStartsOn: 1 });
      endDate = endOfWeek(monthEnd, { weekStartsOn: 1 });
    } else {
      startDate = startOfWeek(currentDate, { weekStartsOn: 1 });
      endDate = endOfWeek(currentDate, { weekStartsOn: 1 });
    }

    const rows = [];
    let days = [];
    let day = startDate;
    let formattedDate = '';

    while (day <= endDate) {
      for (let i = 0; i < 7; i++) {
        formattedDate = format(day, 'd');
        const cloneDay = day;
        const dayTasks = tasks.filter(t => isSameDay(parseISO(t.startTime), cloneDay));
        const isCurrentMonth = viewMode === 'week' ? true : isSameMonth(day, startOfMonth(currentDate));
        const isToday = isSameDay(day, new Date());
        
        days.push(
          <div
            className={`calendar-day ${!isCurrentMonth ? 'disabled' : ''} ${isToday ? 'today' : ''}`}
            key={day.toString()}
          >
            <span className="day-number">{formattedDate}</span>
            <div className="day-tasks">
              {/* Current Time Line for Today in Week View */}
              {isToday && viewMode === 'week' && (
                <div className="week-view-current-time-marker" style={{
                  top: `${(currentTime.getHours() * 60 + currentTime.getMinutes()) / (24 * 60) * 100}%`
                }}>
                  <div className="marker-line"></div>
                  <div className="marker-dot"></div>
                </div>
              )}
              
              {dayTasks.map(task => (
                <div 
                  key={task.id} 
                  className={`mini-task importance-${task.importance || 'normal'} ${task.completed ? 'task-completed' : ''}`}
                  title={task.name}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedTask(task);
                  }}
                >
                  <span className="task-dot"></span>
                  <div className="task-info">
                    <span className="task-time">{format(parseISO(task.startTime), 'HH:mm')}</span>
                    <span className="task-name">{task.name}</span>
                  </div>
                </div>
              ))}
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
    <>
      <Card className="schedule-container">
        <CardHeader className="schedule-header">
          <div className="header-left">
            <CardTitle>全部日程</CardTitle>
            <div className="view-controls">
              <Button 
                variant={viewMode === 'month' ? 'primary' : 'outline'} 
                size="sm"
                onClick={() => setViewMode('month')}
              >
                <CalendarIcon size={16} style={{ marginRight: '6px' }} /> 月视图
              </Button>
              <Button 
                variant={viewMode === 'week' ? 'primary' : 'outline'} 
                size="sm"
                onClick={() => setViewMode('week')}
              >
                <List size={16} style={{ marginRight: '6px' }} /> 周视图
              </Button>
            </div>
          </div>
          
          <div className="header-right">
            <div className="date-navigation">
              <Button variant="ghost" size="sm" onClick={() => navigate('prev')}><ChevronLeft size={20} /></Button>
              <Button variant="outline" size="sm" onClick={() => navigate('today')}>今天</Button>
              <span className="current-date-label">
                {format(currentDate, 'yyyy年MM月', { locale: zhCN })}
              </span>
              <Button variant="ghost" size="sm" onClick={() => navigate('next')}><ChevronRight size={20} /></Button>
            </div>
            <Button className="add-schedule-btn" onClick={() => setIsModalOpen(true)}>
              <Plus size={18} /> 添加日程
            </Button>
          </div>
        </CardHeader>

        <CardContent className="calendar-view-wrapper" style={viewMode === 'week' ? { padding: 0 } : {}}>
          {viewMode === 'week' ? (
            loading ? <div className="loading-overlay">加载中...</div> : renderWeekView()
          ) : (
            <div className="calendar-view">
              <div className="calendar-header">
                {['一', '二', '三', '四', '五', '六', '日'].map(d => (
                  <div key={d} className="week-day">{d}</div>
                ))}
              </div>
              {loading ? <div className="loading-overlay">加载中...</div> : renderCalendar()}
            </div>
          )}
        </CardContent>
      </Card>
      <AddTaskModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onTaskCreated={fetchTasks}
      />
      <TaskDetailModal
        isOpen={!!selectedTask}
        onClose={() => setSelectedTask(null)}
        task={selectedTask}
        onTaskUpdated={fetchTasks}
      />
    </>
  );
};

export default AllSchedule;
