import React from 'react';
import { format, parseISO } from 'date-fns';
import { updateTask, deleteTask, type Task, ScheduleConflictError } from '../../services/api';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Textarea } from '../ui/Textarea';
import { ToggleButton } from '../ui/ToggleButton';
import { Trash2, CheckCircle2, Circle, MapPin, Clock } from 'lucide-react';
import BaseScheduleView from './BaseScheduleView';
import type { BaseScheduleProps } from './BaseScheduleView';
import '../../styles/Schedule.css';

interface TaskDetailModalProps extends BaseScheduleProps {
  task: Task | null;
  onTaskUpdated: () => void;
}

interface TaskDetailState {
  isEditing: boolean;
  editedTask: Partial<Task>;
  isSubmitting: boolean;
  error: string;
  showConflictModal: boolean;
  showDeleteModal: boolean;
  conflictTasks: Task[];
}

class TaskDetailModal extends BaseScheduleView<TaskDetailModalProps, TaskDetailState> {
  constructor(props: TaskDetailModalProps) {
    super(props);
    this.state = {
      isEditing: false,
      editedTask: {},
      isSubmitting: false,
      error: '',
      showConflictModal: false,
      showDeleteModal: false,
      conflictTasks: [],
    };
  }

  componentDidUpdate(prevProps: TaskDetailModalProps) {
    if (this.props.task && (this.props.task !== prevProps.task || this.props.isOpen !== prevProps.isOpen)) {
      const task = this.props.task;
      this.setState({
        editedTask: {
          name: task!.name,
          description: task!.description,
          location: task!.location,
          startTime: task!.startTime,
          endTime: task!.endTime,
          completed: task!.completed,
          importance: task!.importance || 'normal',
        },
        isEditing: false,
        error: '',
      });
    }
  }

  private handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    this.setState(prev => ({ editedTask: { ...prev.editedTask, [name]: value } }));
  };

  private handleTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    const task = this.props.task;
    if (!task) return;
    const originalDate = parseISO(task.startTime);
    const dateStr = format(originalDate, 'yyyy-MM-dd');
    const newDateTime = new Date(`${dateStr}T${value}`).toISOString();
    this.setState(prev => ({ editedTask: { ...prev.editedTask, [name]: newDateTime } }));
  };

  private handleSave = async () => {
    const task = this.props.task;
    if (!task) return;
    this.setState({ isSubmitting: true, error: '' });
    try {
      const result = await updateTask(task.id, this.state.editedTask);
      if (result.conflictWarning) {
        this.setState({ conflictTasks: result.conflictWarning.conflicts, showConflictModal: true });
        this.props.onTaskUpdated();
        this.setState({ isEditing: false });
      } else {
        this.props.onTaskUpdated();
        this.setState({ isEditing: false });
        this.props.onClose();
      }
    } catch (err: any) {
      console.error('Failed to update task', err);
      if (err instanceof ScheduleConflictError) {
        this.setState({ conflictTasks: err.conflicts, showConflictModal: true });
      } else {
        this.setState({ error: err instanceof Error ? err.message : '更新失败' });
      }
    } finally {
      this.setState({ isSubmitting: false });
    }
  };

  private handleToggleComplete = async () => {
    const task = this.props.task;
    if (!task) return;
    this.setState({ isSubmitting: true });
    try {
      await updateTask(task.id, { completed: !task.completed });
      this.props.onTaskUpdated();
      this.props.onClose();
    } catch (err: any) {
      this.setState({ error: err instanceof Error ? err.message : '操作失败' });
    } finally {
      this.setState({ isSubmitting: false });
    }
  };

  private handleDeleteOnlyInstance = async () => {
    const task = this.props.task;
    if (!task) return;
    this.setState({ isSubmitting: true });
    try {
      await deleteTask(task.id, false);
      this.props.onTaskUpdated();
      this.props.onClose();
    } catch (err: any) {
      this.setState({ error: err instanceof Error ? err.message : '删除失败' });
    } finally {
      this.setState({ isSubmitting: false, showDeleteModal: false });
    }
  };

  private handleDeleteEntireParent = async () => {
    const task = this.props.task;
    if (!task) return;
    this.setState({ isSubmitting: true });
    try {
      const parentId = task.parentTaskId || task.id;
      await deleteTask(parentId, true);
      this.props.onTaskUpdated();
      this.props.onClose();
    } catch (err: any) {
      this.setState({ error: err instanceof Error ? err.message : '删除失败' });
    } finally {
      this.setState({ isSubmitting: false, showDeleteModal: false });
    }
  };

  private formatTimeValue = (isoString?: string) => {
    if (!isoString) return '';
    return format(parseISO(isoString), 'HH:mm');
  };

  public render() {
    const { task, onClose } = this.props;
    if (!task) return null;

    const { isEditing, editedTask, isSubmitting, error, conflictTasks } = this.state;

    return (
      <>
        {this.renderModal(isEditing ? '编辑日程' : '日程详情', (
          <>
            {error && <div className="error-banner">{error}</div>}
            <div className="task-detail-content">
              {!isEditing ? (
                <div className="view-mode">
                  <div className="detail-header">
                    <h2 className={`task-title ${task.completed ? 'completed' : ''}`}>{task.name}</h2>
                    <ToggleButton
                      isToggled={task.completed}
                      onToggle={this.handleToggleComplete}
                      toggledIcon={<CheckCircle2 size={20} />}
                      untoggledIcon={<Circle size={20} />}
                      toggledText="已完成"
                      untoggledText="未完成"
                      disabled={isSubmitting}
                    />
                  </div>

                  <div className="detail-row">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <div style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        backgroundColor: task.importance === 'high' ? '#ef4444' : task.importance === 'low' ? '#10b981' : '#3b82f6'
                      }} />
                      <span style={{ fontSize: '0.9rem', color: 'var(--color-text-secondary)' }}>
                        {task.importance === 'high' ? '高优先级' : task.importance === 'low' ? '低优先级' : '普通优先级'}
                      </span>
                    </div>
                  </div>

                  <div className="detail-row">
                    <Clock size={16} className="detail-icon" />
                    <span>{format(parseISO(task.startTime), 'yyyy年MM月dd日 HH:mm')} - {format(parseISO(task.endTime), 'HH:mm')}</span>
                  </div>

                  {task.location && (
                    <div className="detail-row">
                      <MapPin size={16} className="detail-icon" />
                      <span>{task.location}</span>
                    </div>
                  )}

                  {task.description && (
                    <div className="detail-description"><p>{task.description}</p></div>
                  )}
                </div>
              ) : (
                <div className="edit-mode add-task-form">
                  <Input label="日程标题" name="name" value={(editedTask as any).name} onChange={this.handleInputChange} required />
                  <div className="ui-input-wrapper">
                    <label className="ui-label">重要性</label>
                    <select name="importance" value={(editedTask as any).importance} onChange={this.handleInputChange} className="ui-input">
                      <option value="high">高</option>
                      <option value="normal">中</option>
                      <option value="low">低</option>
                    </select>
                  </div>

                  <div className="time-inputs">
                    <Input label="开始时间" name="startTime" type="time" value={this.formatTimeValue((editedTask as any).startTime)} onChange={this.handleTimeChange} required />
                    <Input label="结束时间" name="endTime" type="time" value={this.formatTimeValue((editedTask as any).endTime)} onChange={this.handleTimeChange} required />
                  </div>

                  <Input label="地点" name="location" value={(editedTask as any).location} onChange={this.handleInputChange} />
                  <Textarea label="描述" name="description" value={(editedTask as any).description} onChange={this.handleInputChange} />
                </div>
              )}
            </div>
          </>
        ), (
          <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
            {!isEditing ? (
              <>
                <Button variant="danger" onClick={() => this.setState({ showDeleteModal: true })} disabled={isSubmitting}><Trash2 size={16} style={{ marginRight: '6px' }} /> 删除</Button>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <Button variant="secondary" onClick={onClose}>关闭</Button>
                  <Button onClick={() => this.setState({ isEditing: true })}>编辑</Button>
                </div>
              </>
            ) : (
              <>
                <Button variant="secondary" onClick={() => this.setState({ isEditing: false })} disabled={isSubmitting}>取消</Button>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <Button onClick={this.handleSave} disabled={isSubmitting}>{isSubmitting ? '保存中...' : '保存'}</Button>
                </div>
              </>
            )}
          </div>
        ))}

        {/* Delete confirmation modal - rendered when requested */}
        {this.state.showDeleteModal && this.props.task && this.renderModal('确认删除', (
          <div>
            {this.props.task.parentTaskId ? (
              <p>这是由父级周常/日常任务生成的实例。你可以选择仅删除这一次，或删除整个父级日程及其所有实例。</p>
            ) : (
              <p>这是一个父级日程，删除将同时移除它生成的所有实例。确定要删除父级日程 “{this.props.task.name}” 吗？此操作无法撤销。</p>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: 12 }}>
              <Button variant="secondary" onClick={() => this.setState({ showDeleteModal: false })} disabled={isSubmitting}>取消</Button>
              {this.props.task.parentTaskId ? (
                <>
                  <Button variant="secondary" onClick={this.handleDeleteOnlyInstance} disabled={isSubmitting}>{isSubmitting ? '处理中...' : '仅删除这一次'}</Button>
                  <Button variant="danger" onClick={this.handleDeleteEntireParent} disabled={isSubmitting}>{isSubmitting ? '删除中...' : '删除父级日程及所有实例'}</Button>
                </>
              ) : (
                <Button variant="danger" onClick={this.handleDeleteEntireParent} disabled={isSubmitting}>{isSubmitting ? '删除中...' : '确认删除'}</Button>
              )}
            </div>
          </div>
        ))}

        {/* Conflict modal - rendered when requested */}
        {this.state.showConflictModal && this.renderModal('日程冲突提醒', (
          <>
            <p style={{ marginBottom: '1rem', color: 'var(--color-text-medium)' }}>日程已更新，但与以下日程存在时间冲突：</p>
            <div className="conflict-list" style={{ maxHeight: '200px', overflowY: 'auto' }}>
              {conflictTasks.map(t => (
                <div key={t.id} style={{ padding: '10px', marginBottom: '8px', backgroundColor: '#fff5f5', border: '1px solid #feb2b2', borderRadius: '6px', fontSize: '0.9rem' }}>
                  <div style={{ fontWeight: 'bold', color: '#c53030' }}>{t.name}</div>
                  <div style={{ color: '#742a2a', fontSize: '0.85rem', marginTop: '4px' }}>{format(parseISO(t.startTime), 'HH:mm')} - {format(parseISO(t.endTime), 'HH:mm')}</div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
              <Button onClick={() => this.setState({ showConflictModal: false })}>我知道了</Button>
            </div>
          </>
        ))}
      </>
    );
  }
}

export default TaskDetailModal;
