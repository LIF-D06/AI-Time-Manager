import React, { useState } from 'react';
import { format } from 'date-fns';
import { createTask } from '../../services/api';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Textarea } from '../ui/Textarea';
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
  });
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
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
    });
    setFormError('');
    setTaskType('interval');
  };

  const handleClose = () => {
    resetForm();
    onClose();
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
      let taskData;

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
        };
      }

      await createTask(taskData);
      onTaskCreated();
      handleClose();
    } catch (error) {
      console.error('Failed to create task', error);
      setFormError('创建任务失败，请检查控制台输出。');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="添加新日程"
      footer={
        <>
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
          </div>
        ) : (
          <Input
            label="截止日期"
            name="dueDate"
            type="datetime-local"
            value={newTask.dueDate}
            onChange={handleInputChange}
            required
          />
        )}
      </div>
    </Modal>
  );
};

export default AddTaskModal;
