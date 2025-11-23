import React, { useState, useEffect } from 'react';
import { format, parseISO } from 'date-fns';
import { updateTask, deleteTask, type Task, ScheduleConflictError } from '../../services/api';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Textarea } from '../ui/Textarea';
import { Trash2, CheckCircle2, Circle, MapPin, Clock } from 'lucide-react';
import '../../styles/Schedule.css';

interface TaskDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  task: Task | null;
  onTaskUpdated: () => void;
}

const TaskDetailModal: React.FC<TaskDetailModalProps> = ({ isOpen, onClose, task, onTaskUpdated }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editedTask, setEditedTask] = useState<Partial<Task>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [showConflictModal, setShowConflictModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [conflictTasks, setConflictTasks] = useState<Task[]>([]);

  useEffect(() => {
    if (task) {
      setEditedTask({
        name: task.name,
        description: task.description,
        location: task.location,
        startTime: task.startTime,
        endTime: task.endTime,
        completed: task.completed,
      });
      setIsEditing(false);
      setError('');
    }
  }, [task, isOpen]);

  if (!task) return null;

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setEditedTask(prev => ({ ...prev, [name]: value }));
  };

  const handleTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    // value is HH:mm, need to combine with date from original task
    const originalDate = parseISO(task.startTime); // Assuming start and end are on same day for simplicity or use original date part
    const dateStr = format(originalDate, 'yyyy-MM-dd');
    const newDateTime = new Date(`${dateStr}T${value}`).toISOString();
    setEditedTask(prev => ({ ...prev, [name]: newDateTime }));
  };

  const handleSave = async () => {
    setIsSubmitting(true);
    setError('');
    try {
      await updateTask(task.id, editedTask);
      onTaskUpdated();
      setIsEditing(false);
      onClose();
    } catch (err) {
      if (err instanceof ScheduleConflictError) {
        setConflictTasks(err.conflicts);
        setShowConflictModal(true);
      } else {
        setError(err instanceof Error ? err.message : '更新失败');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleComplete = async () => {
    setIsSubmitting(true);
    try {
      await updateTask(task.id, { completed: !task.completed });
      onTaskUpdated();
      // Don't close modal, just update state via parent refresh or local optimistic update?
      // Better to close or refresh. Let's refresh and keep open if possible, but for now close or just refresh.
      // Actually, onTaskUpdated will fetch new data, but this modal uses `task` prop. 
      // The parent needs to update the `task` prop or we close the modal.
      // Let's close the modal for simplicity as the list might change order/visibility.
      onClose(); 
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteClick = () => {
    setShowDeleteModal(true);
  };

  const handleConfirmDelete = async () => {
    setIsSubmitting(true);
    try {
      await deleteTask(task.id);
      onTaskUpdated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    } finally {
      setIsSubmitting(false);
      setShowDeleteModal(false);
    }
  };

  const formatTimeValue = (isoString?: string) => {
    if (!isoString) return '';
    return format(parseISO(isoString), 'HH:mm');
  };

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={isEditing ? "编辑日程" : "日程详情"}
        footer={
          <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
            {!isEditing ? (
              <>
                <Button variant="danger" onClick={handleDeleteClick} disabled={isSubmitting}>
                  <Trash2 size={16} style={{ marginRight: '6px' }} /> 删除
                </Button>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <Button variant="secondary" onClick={onClose}>关闭</Button>
                  <Button onClick={() => setIsEditing(true)}>编辑</Button>
                </div>
              </>
            ) : (
              <>
                <Button variant="secondary" onClick={() => setIsEditing(false)} disabled={isSubmitting}>取消</Button>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <Button onClick={handleSave} disabled={isSubmitting}>
                    {isSubmitting ? '保存中...' : '保存'}
                  </Button>
                </div>
              </>
            )}
          </div>
        }
      >
        {error && <div className="error-banner">{error}</div>}
        
        <div className="task-detail-content">
          {!isEditing ? (
            <div className="view-mode">
              <div className="detail-header">
                <h2 className={`task-title ${task.completed ? 'completed' : ''}`}>
                  {task.name}
                </h2>
                <Button 
                  variant="ghost" 
                  className={`status-btn ${task.completed ? 'completed' : ''}`}
                  onClick={handleToggleComplete}
                  disabled={isSubmitting}
                >
                  {task.completed ? (
                    <><CheckCircle2 size={20} /> 已完成</>
                  ) : (
                    <><Circle size={20} /> 未完成</>
                  )}
                </Button>
              </div>
              
              <div className="detail-row">
                <Clock size={16} className="detail-icon" />
                <span>
                  {format(parseISO(task.startTime), 'yyyy年MM月dd日 HH:mm')} - {format(parseISO(task.endTime), 'HH:mm')}
                </span>
              </div>
              
              {task.location && (
                <div className="detail-row">
                  <MapPin size={16} className="detail-icon" />
                  <span>{task.location}</span>
                </div>
              )}
              
              {task.description && (
                <div className="detail-description">
                  <p>{task.description}</p>
                </div>
              )}
            </div>
          ) : (
            <div className="edit-mode add-task-form">
              <Input
                label="日程标题"
                name="name"
                value={editedTask.name}
                onChange={handleInputChange}
                required
              />
              
              <div className="time-inputs">
                <Input
                  label="开始时间"
                  name="startTime"
                  type="time"
                  value={formatTimeValue(editedTask.startTime)}
                  onChange={handleTimeChange}
                  required
                />
                <Input
                  label="结束时间"
                  name="endTime"
                  type="time"
                  value={formatTimeValue(editedTask.endTime)}
                  onChange={handleTimeChange}
                  required
                />
              </div>

              <Input
                label="地点"
                name="location"
                value={editedTask.location}
                onChange={handleInputChange}
              />

              <Textarea
                label="描述"
                name="description"
                value={editedTask.description}
                onChange={handleInputChange}
              />
            </div>
          )}
        </div>
      </Modal>

      <Modal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        title="确认删除"
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
            <Button variant="secondary" onClick={() => setShowDeleteModal(false)} disabled={isSubmitting}>
              取消
            </Button>
            <Button variant="danger" onClick={handleConfirmDelete} disabled={isSubmitting}>
              {isSubmitting ? '删除中...' : '确认删除'}
            </Button>
          </div>
        }
      >
        <p>确定要删除日程 “{task.name}” 吗？此操作无法撤销。</p>
      </Modal>

      <Modal
        isOpen={showConflictModal}
        onClose={() => setShowConflictModal(false)}
        title="日程冲突提醒"
        footer={
          <Button onClick={() => setShowConflictModal(false)}>
            返回修改
          </Button>
        }
      >
        <p style={{ marginBottom: '1rem', color: 'var(--color-text-medium)' }}>
          修改后的时间与以下日程存在冲突：
        </p>
        <div className="conflict-list" style={{ maxHeight: '200px', overflowY: 'auto' }}>
          {conflictTasks.map(t => (
            <div key={t.id} style={{ 
              padding: '10px', 
              marginBottom: '8px', 
              backgroundColor: '#fff5f5', 
              border: '1px solid #feb2b2',
              borderRadius: '6px',
              fontSize: '0.9rem'
            }}>
              <div style={{ fontWeight: 'bold', color: '#c53030' }}>{t.name}</div>
              <div style={{ color: '#742a2a', fontSize: '0.85rem', marginTop: '4px' }}>
                {format(parseISO(t.startTime), 'HH:mm')} - {format(parseISO(t.endTime), 'HH:mm')}
              </div>
            </div>
          ))}
        </div>
      </Modal>
    </>
  );
};

export default TaskDetailModal;
