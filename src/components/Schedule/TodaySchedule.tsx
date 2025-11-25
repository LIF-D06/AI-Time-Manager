import React, { useState, useEffect } from 'react';
import { getTasks, type Task, updateTask } from '../../services/api';
import { useWeek } from '../../context/WeekContext';
import { format, parseISO } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { Calendar, Clock, MapPin, CheckCircle2, Circle, Plus, RefreshCw } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import { Button } from '../ui/Button';
import AddTaskModal from './AddTaskModal';
import TaskDetailModal from './TaskDetailModal';
import { Modal } from '../ui/Modal';
import CurrentTimeDisplay from '../ui/CurrentTimeDisplay';
import '../../styles/Schedule.css';

const TodaySchedule: React.FC = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [taskToComplete, setTaskToComplete] = useState<Task | null>(null);
  const [isCompleting, setIsCompleting] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const { weekInfo } = useWeek();
  const effectiveWeek = weekInfo ? weekInfo.effectiveWeek : null;

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  const fetchTodayTasks = async () => {
    setLoading(true);
    try {
      const today = new Date();
      // 获取本地当天的 00:00:00 和 23:59:59
      const start = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0);
      const end = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
      
      // 打印本地时间和 UTC 查询时间，方便调试
      console.log(`Fetching today's tasks (Local): ${format(start, 'yyyy-MM-dd HH:mm:ss')} to ${format(end, 'yyyy-MM-dd HH:mm:ss')}`);
      console.log(`Fetching today's tasks (UTC): ${start.toISOString()} to ${end.toISOString()}`);
      
      const response = await getTasks({ start: start.toISOString(), end: end.toISOString(), limit: 500 });
      console.log(`Fetched ${response.tasks.length} tasks for today`);
      setTasks(response.tasks);
    } catch (error) {
      console.error('Failed to fetch tasks', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTodayTasks();
  }, []);

  // week info provided by WeekContext at app startup

  const getStatusColor = (task: Task) => {
    if (task.completed) return 'status-completed';
    const now = new Date();
    const start = parseISO(task.startTime);
    const end = parseISO(task.endTime);
    
    if (now >= start && now <= end) return 'status-active';
    if (now > end) return 'status-overdue';
    return 'status-upcoming';
  };

  const handleOpenCompleteModal = (task: Task) => {
    setTaskToComplete(task);
  };

  const handleCloseCompleteModal = () => {
    setTaskToComplete(null);
  };

  const handleToggleTaskStatus = async () => {
    if (!taskToComplete) return;

    setIsCompleting(true);
    try {
      await updateTask(taskToComplete.id, { completed: !taskToComplete.completed });
      await fetchTodayTasks(); // Refresh the tasks list
      handleCloseCompleteModal();
    } catch (error) {
      console.error('Failed to update task status', error);
      // Optionally, show an error message to the user
    } finally {
      setIsCompleting(false);
    }
  };

  return (
    <>
      <Card className="schedule-container">
        <CardHeader className="schedule-header today-header">
          <div className="header-left">
            <CardTitle>今日日程</CardTitle>
            <p className="date-subtitle">{format(new Date(), 'yyyy年MM月dd日 EEEE', { locale: zhCN })}</p>
            {effectiveWeek !== null && <div className="week-badge">第 {effectiveWeek} 周</div>}
          </div>
          <div className="header-right">
            <Button variant="ghost" size="sm" onClick={fetchTodayTasks} title="刷新日程">
              <RefreshCw size={18} />
            </Button>
            <Button onClick={() => setIsModalOpen(true)}>
              <Plus size={18} /> 添加日程
            </Button>
            <CurrentTimeDisplay />
          </div>
        </CardHeader>

        <CardContent className="timeline-view-wrapper">
          <div className="timeline-view">
            {loading ? (
              <div className="loading-state">加载中...</div>
            ) : tasks.length === 0 ? (
              <div className="empty-state">
                <Calendar size={48} />
                <p>今天没有安排日程</p>
                <Button onClick={() => setIsModalOpen(true)} style={{ marginTop: '1rem' }}>
                  <Plus size={18} /> 添加第一个日程
                </Button>
              </div>
            ) : (
              tasks.map((task, index) => {
                // Calculate if we should show the current time line before this task
                const now = currentTime;
                const taskStart = parseISO(task.startTime);
                const taskEnd = parseISO(task.endTime);
                
                // Check if this is the first task and now is before it
                const showLineBefore = index === 0 && now < taskStart;
                
                // Check if now is between previous task and this task
                const prevTask = index > 0 ? tasks[index - 1] : null;
                const prevTaskEnd = prevTask ? parseISO(prevTask.endTime) : null;
                const showLineBetween = prevTaskEnd && now > prevTaskEnd && now < taskStart;

                // Check if task is active (now is inside task duration)
                const isActive = now >= taskStart && now <= taskEnd;

                return (
                  <React.Fragment key={task.id}>
                    {/* Current Time Line (Before or Between) */}
                    {(showLineBefore || showLineBetween) && (
                      <div className="timeline-current-time-indicator">
                        <div className="time-line-left">
                          <span className="current-time-label">{format(now, 'HH:mm')}</span>
                        </div>
                        <div className="time-line-divider"></div>
                      </div>
                    )}

                    <div className={`timeline-item ${getStatusColor(task)}`}>
                      <div className="time-column">
                        <span className="start-time">{format(parseISO(task.startTime), 'HH:mm')}</span>
                        <span className="duration">
                          {format(parseISO(task.endTime), 'HH:mm')}
                        </span>
                      </div>
                      <div className="content-column">
                        {/* Active Task Indicator Overlay */}
                        {isActive && (
                          <div className="active-task-indicator-line" style={{
                            top: `${Math.min(100, Math.max(0, (now.getTime() - taskStart.getTime()) / (taskEnd.getTime() - taskStart.getTime()) * 100))}%`
                          }}>
                            <div className="active-time-dot"></div>
                          </div>
                        )}
                        
                        <div className="task-card" onClick={() => setSelectedTask(task)} style={{ cursor: 'pointer' }}>
                          <div className="task-header">
                            <h3>{task.name}</h3>
                            {task.completed ? (
                              <CheckCircle2 
                                className="icon-completed" 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenCompleteModal(task);
                                }}
                                style={{ cursor: 'pointer' }}
                              />
                            ) : (
                              <Circle
                                className="icon-pending"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenCompleteModal(task);
                                }}
                                style={{ cursor: 'pointer' }}
                              />
                            )}
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
                    
                    {/* Show line after last task if now is later */}
                    {index === tasks.length - 1 && now > taskEnd && (
                      <div className="timeline-current-time-indicator">
                        <div className="time-line-left">
                          <span className="current-time-label">{format(now, 'HH:mm')}</span>
                        </div>
                        <div className="time-line-divider"></div>
                      </div>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>

      <AddTaskModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onTaskCreated={fetchTodayTasks}
      />

      <TaskDetailModal
        isOpen={!!selectedTask}
        onClose={() => setSelectedTask(null)}
        task={selectedTask}
        onTaskUpdated={fetchTodayTasks}
      />

      {taskToComplete && (
        <Modal
          isOpen={!!taskToComplete}
          onClose={handleCloseCompleteModal}
          title={taskToComplete.completed ? "确认重置日程" : "确认完成日程"}
        >
          <p>您确定要将日程 “{taskToComplete.name}” 标记为{taskToComplete.completed ? "未完成" : "完成"}吗？</p>
          <div className="modal-actions">
            <Button variant="outline" onClick={handleCloseCompleteModal} disabled={isCompleting}>
              取消
            </Button>
            <Button onClick={handleToggleTaskStatus} disabled={isCompleting}>
              {isCompleting ? '处理中...' : (taskToComplete.completed ? '确认重置' : '确认完成')}
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
};

export default TodaySchedule;
