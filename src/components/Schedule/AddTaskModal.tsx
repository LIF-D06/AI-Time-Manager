import React, { useState, useRef } from 'react';
import { format, parseISO } from 'date-fns';
import { createTask, createTasksBatch, ScheduleConflictError, type Task, type ScheduleType } from '../../services/api';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Textarea } from '../ui/Textarea';
import { Upload } from 'lucide-react';
import '../../styles/Schedule.css';

type TaskType = 'interval' | 'point';

interface AddTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTaskCreated: () => void;
}

const AddTaskModal: React.FC<AddTaskModalProps> = ({ isOpen, onClose, onTaskCreated }) => {
  const [taskType, setTaskType] = useState<TaskType>('interval');
  const [newTask, setNewTask] = useState({
    name: '',
    description: '',
    startTime: format(new Date(), 'HH:mm'),
    endTime: format(new Date(), 'HH:mm'),
    dueDate: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
    location: '',
    importance: 'normal' as 'high' | 'normal' | 'low',
  });
  const [recurrenceType, setRecurrenceType] = useState<'none' | 'dailyOnDays' | 'weeklyByWeekNumber'>('none');
  const [recurrenceDays, setRecurrenceDays] = useState<number[]>([]); // 0-6
  const [recurrenceWeeks, setRecurrenceWeeks] = useState<string>(''); // comma separated numbers
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showConflictModal, setShowConflictModal] = useState(false);
  const [conflictTasks, setConflictTasks] = useState<Task[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setNewTask({ ...newTask, [name]: value });
  };

  const resetForm = () => {
    setNewTask({
      name: '',
      description: '',
      startTime: format(new Date(), 'HH:mm'),
      endTime: format(new Date(), 'HH:mm'),
      dueDate: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
      location: '',
      importance: 'normal',
    });
    setFormError('');
    setTaskType('interval');
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const parseIcsDate = (dateStr: string): Date => {
    // Basic parsing for YYYYMMDDTHHMMSSZ or YYYYMMDDTHHMMSS
    const year = parseInt(dateStr.substring(0, 4));
    const month = parseInt(dateStr.substring(4, 6)) - 1;
    const day = parseInt(dateStr.substring(6, 8));
    
    if (dateStr.length <= 8) {
      // Date only
      return new Date(year, month, day);
    }

    const hour = parseInt(dateStr.substring(9, 11)) || 0;
    const minute = parseInt(dateStr.substring(11, 13)) || 0;
    const second = parseInt(dateStr.substring(13, 15)) || 0;
    
    if (dateStr.endsWith('Z')) {
      return new Date(Date.UTC(year, month, day, hour, minute, second));
    }
    return new Date(year, month, day, hour, minute, second);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsSubmitting(true);
    setFormError('');

    try {
      const text = await file.text();
      const lines = text.split(/\r\n|\n|\r/);
      const tasksToCreate: any[] = [];
      let currentEvent: any = null;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        if (line.startsWith('BEGIN:VEVENT')) {
          currentEvent = {};
        } else if (line.startsWith('END:VEVENT')) {
          if (currentEvent && currentEvent.summary && currentEvent.dtStart && currentEvent.dtEnd) {
            tasksToCreate.push({
              name: currentEvent.summary,
              description: currentEvent.description || '',
              location: currentEvent.location || '',
              startTime: currentEvent.dtStart.toISOString(),
              endTime: currentEvent.dtEnd.toISOString(),
              dueDate: currentEvent.dtEnd.toISOString(),
              pushedToMSTodo: false,
              scheduleType: 'single',
            });
          }
          currentEvent = null;
        } else if (currentEvent) {
          if (line.startsWith('SUMMARY:')) {
            currentEvent.summary = line.substring(8);
          } else if (line.startsWith('DESCRIPTION:')) {
            currentEvent.description = line.substring(12);
          } else if (line.startsWith('LOCATION:')) {
            currentEvent.location = line.substring(9);
          } else if (line.startsWith('DTSTART')) {
            const parts = line.split(':');
            const dateStr = parts[parts.length - 1];
            currentEvent.dtStart = parseIcsDate(dateStr);
          } else if (line.startsWith('DTEND')) {
            const parts = line.split(':');
            const dateStr = parts[parts.length - 1];
            currentEvent.dtEnd = parseIcsDate(dateStr);
          }
        }
      }

      if (tasksToCreate.length > 0) {
        const result = await createTasksBatch(tasksToCreate);
        const { created, conflicts, errors } = result.summary;
        
        let message = `批量导入完成：成功 ${created} 个`;
        if (conflicts > 0) message += `，跳过冲突 ${conflicts} 个`;
        if (errors > 0) message += `，失败 ${errors} 个`;
        
        alert(message);
        
        if (created > 0) {
          onTaskCreated();
          handleClose();
        }
      } else {
        setFormError('未能在文件中找到有效的日程事件');
      }
    } catch (error) {
      console.error('Failed to parse ICS file or batch create tasks', error);
      setFormError('导入失败：' + (error instanceof Error ? error.message : '未知错误'));
    } finally {
      setIsSubmitting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleAddTask = async () => {
    if (!newTask.name || (taskType === 'interval' && (!newTask.startTime || !newTask.endTime)) || (taskType === 'point' && !newTask.dueDate)) {
      setFormError('请填写所有必填项。');
      return;
    }
    setFormError('');
    setIsSubmitting(true);

    try {
      const todayStr = format(new Date(), 'yyyy-MM-dd');
      let taskData: any;

      let scheduleType: ScheduleType = 'single';

      if (taskType === 'interval') {
        const startTime = new Date(`${todayStr}T${newTask.startTime}`);
        const endTime = new Date(`${todayStr}T${newTask.endTime}`);
        taskData = {
          name: newTask.name,
          description: newTask.description,
          location: newTask.location,
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          dueDate: endTime.toISOString(),
          pushedToMSTodo: false,
          importance: newTask.importance,
          scheduleType,
        };
      } else { // point task
        const dueDate = new Date(newTask.dueDate);
        taskData = {
          name: newTask.name,
          description: newTask.description,
          location: newTask.location,
          startTime: dueDate.toISOString(),
          endTime: dueDate.toISOString(),
          dueDate: dueDate.toISOString(),
          pushedToMSTodo: false,
          importance: newTask.importance,
          scheduleType,
        };
      }

      // attach recurrenceRule if user selected recurrence
      if (recurrenceType !== 'none') {
        if (recurrenceType === 'dailyOnDays') {
          taskData.recurrenceRule = {
            freq: 'dailyOnDays',
            days: recurrenceDays
          };
          taskData.scheduleType = 'recurring_daily_on_days';
        } else if (recurrenceType === 'weeklyByWeekNumber') {
          const weeks = recurrenceWeeks.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
          taskData.recurrenceRule = {
            freq: 'weeklyByWeekNumber',
            weeks
          };
          taskData.scheduleType = 'recurring_weekly_by_week_number';
        }
      }

      const result = await createTask(taskData);
      
      if (result.conflictWarning) {
        setConflictTasks(result.conflictWarning.conflicts);
        setShowConflictModal(true);
        onTaskCreated();
        // Don't close the modal immediately so the conflict modal can be seen
        // We will close it when the conflict modal is closed
      } else {
        onTaskCreated();
        handleClose();
      }
    } catch (error) {
      console.error('Failed to create task', error);
      // ScheduleConflictError is no longer thrown for conflicts, but keep for safety
      if (error instanceof ScheduleConflictError) {
        setConflictTasks(error.conflicts);
        setShowConflictModal(true);
      } else {
        setFormError('创建任务失败：' + (error instanceof Error ? error.message : '未知错误'));
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConflictModalClose = () => {
    setShowConflictModal(false);
    handleClose();
  };

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={handleClose}
        title="添加新日程"
        footer={
          <>
            <div style={{ marginRight: 'auto' }}>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept=".ics"
                style={{ display: 'none' }}
              />
              <Button variant="outline" onClick={handleImportClick} disabled={isSubmitting}>
                <Upload size={16} style={{ marginRight: '6px' }} /> 导入日历文件
              </Button>
            </div>
            <Button variant="secondary" onClick={handleClose}>取消</Button>
            <Button onClick={handleAddTask} disabled={isSubmitting}>
              {isSubmitting ? '添加中...' : '确认添加'}
            </Button>
          </>
        }
      >
        {formError && <div className="error-banner">{formError}</div>}
        <div className="add-task-form">
          <div className="task-type-selector">
            <Button 
              variant={taskType === 'interval' ? 'primary' : 'secondary'}
              onClick={() => setTaskType('interval')}
            >
              区间任务
            </Button>
            <Button 
              variant={taskType === 'point' ? 'primary' : 'secondary'}
              onClick={() => setTaskType('point')}
            >
              截止日期任务
            </Button>
          </div>

          <Input
            label="日程标题"
            name="name"
            value={newTask.name}
            onChange={handleInputChange}
            placeholder="例如：团队会议"
            required
          />
          <Textarea
            label="描述 (可选)"
            name="description"
            value={newTask.description}
            onChange={handleInputChange}
            placeholder="例如：讨论下一季度计划"
          />
          <Input
            label="地点 (可选)"
            name="location"
            value={newTask.location}
            onChange={handleInputChange}
            placeholder="例如：会议室 A"
          />
          
          {taskType === 'interval' ? (
            <div className="time-inputs">
              <Input
                label="开始时间"
                name="startTime"
                type="time"
                value={newTask.startTime}
                onChange={handleInputChange}
                required
              />
              <Input
                label="结束时间"
                name="endTime"
                type="time"
                value={newTask.endTime}
                onChange={handleInputChange}
                required
              />
              <div className="ui-input-wrapper" style={{ flex: 1 }}>
                <label className="ui-label">重要性</label>
                <select
                  name="importance"
                  value={newTask.importance}
                  onChange={handleInputChange}
                  className="ui-input"
                >
                  <option value="high">高</option>
                  <option value="normal">中</option>
                  <option value="low">低</option>
                </select>
              </div>
            </div>
          ) : (
            <div className="time-inputs">
              <Input
                label="截止日期"
                name="dueDate"
                type="datetime-local"
                value={newTask.dueDate}
                onChange={handleInputChange}
                required
                style={{ flex: 2 }}
              />
              <div className="ui-input-wrapper" style={{ flex: 1 }}>
                <label className="ui-label">重要性</label>
                <select
                  name="importance"
                  value={newTask.importance}
                  onChange={handleInputChange}
                  className="ui-input"
                >
                  <option value="high">高</option>
                  <option value="normal">中</option>
                  <option value="low">低</option>
                </select>
              </div>
            </div>
          )}
          
          <div style={{ marginTop: 8 }}>
            <label className="ui-label">重复类型 (可选)</label>
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              <Button variant={recurrenceType === 'none' ? 'primary' : 'secondary'} onClick={() => setRecurrenceType('none')}>无</Button>
              <Button variant={recurrenceType === 'dailyOnDays' ? 'primary' : 'secondary'} onClick={() => setRecurrenceType('dailyOnDays')}>日常任务</Button>
              <Button variant={recurrenceType === 'weeklyByWeekNumber' ? 'primary' : 'secondary'} onClick={() => setRecurrenceType('weeklyByWeekNumber')}>周常任务</Button>
            </div>

            {recurrenceType === 'dailyOnDays' && (
              <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {['日','一','二','三','四','五','六'].map((label, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className={`filter-btn ${recurrenceDays.includes((idx)%7) ? 'active' : ''}`}
                    onClick={() => {
                      setRecurrenceDays(prev => prev.includes(idx) ? prev.filter(d=>d!==idx) : [...prev, idx]);
                    }}
                  >{label}</button>
                ))}
              </div>
            )}

            {recurrenceType === 'weeklyByWeekNumber' && (
              <div style={{ marginTop: 8 }}>
                <Input label="周序号 (逗号分隔, ISO 周数)" name="recurrenceWeeks" value={recurrenceWeeks} onChange={(e)=>setRecurrenceWeeks(e.target.value)} placeholder="例如: 1,2,3,5" />
              </div>
            )}
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={showConflictModal}
        onClose={handleConflictModalClose}
        title="日程冲突提醒"
        footer={
          <Button onClick={handleConflictModalClose}>
            我知道了
          </Button>
        }
      >
        <p style={{ marginBottom: '1rem', color: 'var(--color-text-medium)' }}>
          日程已添加，但与以下日程存在时间冲突：
        </p>
        <div className="conflict-list" style={{ maxHeight: '200px', overflowY: 'auto' }}>
          {conflictTasks.map(task => (
            <div key={task.id} style={{ 
              padding: '10px', 
              marginBottom: '8px', 
              backgroundColor: '#fff5f5', 
              border: '1px solid #feb2b2',
              borderRadius: '6px',
              fontSize: '0.9rem'
            }}>
              <div style={{ fontWeight: 'bold', color: '#c53030' }}>{task.name}</div>
              <div style={{ color: '#742a2a', fontSize: '0.85rem', marginTop: '4px' }}>
                {format(parseISO(task.startTime), 'HH:mm')} - {format(parseISO(task.endTime), 'HH:mm')}
              </div>
            </div>
          ))}
        </div>
      </Modal>
    </>
  );
};

export default AddTaskModal;
