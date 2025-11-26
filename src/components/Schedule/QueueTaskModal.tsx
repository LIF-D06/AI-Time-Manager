import React from 'react';
import { format, parseISO } from 'date-fns';
import { createTask, rejectQueueItem, type ScheduleType } from '../../services/api';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Textarea } from '../ui/Textarea';
import BaseScheduleView from './BaseScheduleView';
import type { BaseScheduleProps } from './BaseScheduleView';
import '../../styles/Schedule.css';

interface QueueItem {
  id: string;
  userId: string;
  rawRequest: string | any;
  status: string;
  createdAt: string;
}

interface QueueTaskModalProps extends BaseScheduleProps {
  item: QueueItem | null;
  onAdded: () => void; // called when a task is added (so parent can refresh queue)
}

interface QueueTaskState {
  isEditing: boolean;
  edited: any;
  isSubmitting: boolean;
  error: string;
}

class QueueTaskModal extends BaseScheduleView<QueueTaskModalProps, QueueTaskState> {
  constructor(props: QueueTaskModalProps) {
    super(props);
    this.state = {
      isEditing: true,
      edited: {},
      isSubmitting: false,
      error: '',
    };
  }

  componentDidUpdate(prevProps: QueueTaskModalProps) {
    if (this.props.item && this.props.item !== prevProps.item) {
      let parsed: any = null;
      try { parsed = typeof this.props.item.rawRequest === 'string' ? JSON.parse(this.props.item.rawRequest) : this.props.item.rawRequest; } catch { parsed = null; }
      const args = parsed?.args || parsed || {};

      this.setState({
        edited: {
          name: args.name || args.title || '',
          description: args.description || args.body || '',
          location: args.location || args.place || '',
          startTime: args.startTime || args.start || '',
          endTime: args.endTime || args.end || '',
          importance: args.importance || 'normal',
        },
        isEditing: true,
        error: '',
      });
    }
  }

  private handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    this.setState(prev => ({ edited: { ...prev.edited, [name]: value } }));
  };

  private handleCreateAndRemove = async () => {
    const item = this.props.item;
    this.setState({ isSubmitting: true, error: '' });
    try {
      const edited = this.state.edited;
      const data: any = {
        name: edited.name || '未命名请求',
        description: edited.description || '',
        location: edited.location || '',
        startTime: edited.startTime ? new Date(edited.startTime).toISOString() : new Date().toISOString(),
        endTime: edited.endTime ? new Date(edited.endTime).toISOString() : new Date().toISOString(),
        dueDate: edited.endTime ? new Date(edited.endTime).toISOString() : new Date().toISOString(),
        pushedToMSTodo: false,
        importance: edited.importance || 'normal',
        scheduleType: 'single' as ScheduleType,
      };

      await createTask(data);
      // notify parent to refresh and remove queue item
      try {
        if (item) await rejectQueueItem(item.id);
      } catch (err) {
        console.warn('Failed to remove queue item after create:', err);
      }
      this.props.onAdded();
      this.props.onClose();
    } catch (err: any) {
      console.error('Failed to create task from queue item', err);
      this.setState({ error: err instanceof Error ? err.message : '创建失败' });
    } finally {
      this.setState({ isSubmitting: false });
    }
  };

  public render() {
    const { item, onClose } = this.props;
    if (!item) return null;

    const { isEditing, edited, isSubmitting, error } = this.state;

    return this.renderModal(isEditing ? '编辑待添加日程' : '待添加日程详情', (
      <>
        {error && <div className="error-banner">{error}</div>}

        <div className="add-task-form">
          <Input label="标题" name="name" value={edited.name || ''} onChange={this.handleInputChange} required />
          <Textarea label="描述" name="description" value={edited.description || ''} onChange={this.handleInputChange} />
          <div className="time-inputs">
            <Input label="开始时间" name="startTime" type="datetime-local" value={edited.startTime ? format(parseISO(edited.startTime), "yyyy-MM-dd'T'HH:mm") : ''} onChange={(e)=>this.setState((prev:any)=>({ edited: {...prev.edited, startTime: e.target.value ? new Date(e.target.value).toISOString() : ''} }))} />
            <Input label="结束时间" name="endTime" type="datetime-local" value={edited.endTime ? format(parseISO(edited.endTime), "yyyy-MM-dd'T'HH:mm") : ''} onChange={(e)=>this.setState((prev:any)=>({ edited: {...prev.edited, endTime: e.target.value ? new Date(e.target.value).toISOString() : ''} }))} />
          </div>
          <Input label="地点" name="location" value={edited.location || ''} onChange={this.handleInputChange} />
        </div>
      </>
    ), (
      <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
        <div />
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="secondary" onClick={onClose}>关闭</Button>
          <Button onClick={this.handleCreateAndRemove} disabled={isSubmitting}>{isSubmitting ? '添加中...' : '保存并添加'}</Button>
        </div>
      </div>
    ));
  }
}

export default QueueTaskModal;
