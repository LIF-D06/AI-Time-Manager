import React, { useState, useEffect } from 'react';
import { getTasks, type Task, updateTask } from '../../services/api';
import { format, startOfDay, endOfDay, parseISO } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { Calendar, Clock, MapPin, CheckCircle2, Circle, Plus } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import { Button } from '../ui/Button';
import AddTaskModal from './AddTaskModal';
import { Modal } from '../ui/Modal';
import CurrentTimeDisplay from '../ui/CurrentTimeDisplay';
import '../../styles/Schedule.css';

const TodaySchedule: React.FC = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [taskToComplete, setTaskToComplete] = useState<Task | null>(null);
  const [isCompleting, setIsCompleting] = useState(false);

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

  useEffect(() => {
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

  const handleOpenCompleteModal = (task: Task) => {
    if (!task.completed) {
      setTaskToComplete(task);
    }
  };

  const handleCloseCompleteModal = () => {
    setTaskToComplete(null);
  };

  const handleCompleteTask = async () => {
    if (!taskToComplete) return;

    setIsCompleting(true);
    try {
      await updateTask(taskToComplete.id, { completed: true });
      await fetchTodayTasks(); // Refresh the tasks list
      handleCloseCompleteModal();
    } catch (error) {
      console.error('Failed to complete task', error);
      // Optionally, show an error message to the user
    } finally {
      setIsCompleting(false);
    }
  };

  return (
    <>
      <Card className="schedule-container">
        <CardHeader className="schedule-header">
          <div className="header-left">
            <CardTitle>今日日程</CardTitle>
            <p className="date-subtitle">{format(new Date(), 'yyyy年MM月dd日 EEEE', { locale: zhCN })}</p>
          </div>
          <div className="header-right">
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
                        {task.completed ? (
                          <CheckCircle2 className="icon-completed" />
                        ) : (
                          <Circle
                            className="icon-pending"
                            onClick={() => handleOpenCompleteModal(task)}
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
              ))
            )}
          </div>
        </CardContent>
      </Card>

      <AddTaskModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onTaskCreated={fetchTodayTasks}
      />

      {taskToComplete && (
        <Modal
          isOpen={!!taskToComplete}
          onClose={handleCloseCompleteModal}
          title="确认完成日程"
        >
          <p>您确定要将日程 “{taskToComplete.name}” 标记为完成吗？</p>
          <div className="modal-actions">
            <Button variant="outline" onClick={handleCloseCompleteModal} disabled={isCompleting}>
              取消
            </Button>
            <Button onClick={handleCompleteTask} disabled={isCompleting}>
              {isCompleting ? '标记中...' : '确认完成'}
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
};

export default TodaySchedule;
