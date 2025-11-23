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
        
        days.push(
          <div
            className={`calendar-day ${!isCurrentMonth ? 'disabled' : ''} ${isSameDay(day, new Date()) ? 'today' : ''}`}
            key={day.toString()}
          >
            <span className="day-number">{formattedDate}</span>
            <div className="day-tasks">
              {dayTasks.map(task => (
                <div 
                  key={task.id} 
                  className="mini-task" 
                  title={task.name}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedTask(task);
                  }}
                >
                  <span className="task-dot"></span>
                  <div className="task-info">
                    {viewMode === 'week' && <span className="task-time">{format(parseISO(task.startTime), 'HH:mm')}</span>}
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

        <CardContent className="calendar-view-wrapper">
          <div className="calendar-view">
            <div className="calendar-header">
              {['一', '二', '三', '四', '五', '六', '日'].map(d => (
                <div key={d} className="week-day">{d}</div>
              ))}
            </div>
            {loading ? <div className="loading-overlay">加载中...</div> : renderCalendar()}
          </div>
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
