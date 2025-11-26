import React from 'react';
import { Card } from '../ui/Card';
import { Clock, MapPin } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import '../../styles/Schedule.css';

export interface ScheduleCardProps {
  name: string;
  description?: string;
  startTime: string;
  endTime: string;
  location?: string;
  status?: 'active' | 'completed' | 'overdue' | 'upcoming';
  onClick?: () => void;
  rightActions?: React.ReactNode;
  className?: string;
}

const getStatusColor = (status?: string) => {
  switch (status) {
    case 'completed': return 'status-completed';
    case 'active': return 'status-active';
    case 'overdue': return 'status-overdue';
    case 'upcoming': return 'status-upcoming';
    default: return '';
  }
};

const ScheduleCard: React.FC<ScheduleCardProps> = ({
  name,
  description,
  startTime,
  endTime,
  location,
  status,
  onClick,
  rightActions,
  className = '',
}) => {
  return (
    // reuse existing .task-card styles for consistent appearance in timeline
    <Card className={`task-card ${getStatusColor(status)} ${className}`} onClick={onClick}>
      <div className="task-header">
        <h3>{name}</h3>
      </div>
      {description && <p className="task-desc">{description}</p>}
      <div className="task-meta">
        {location && (
          <span className="meta-item">
            <MapPin size={14} /> {location}
          </span>
        )}
        <span className="meta-item">
          <Clock size={14} /> {format(parseISO(startTime), 'HH:mm')} - {format(parseISO(endTime), 'HH:mm')}
        </span>
      </div>
      {rightActions && (
        <div className="task-footer">
          {rightActions}
        </div>
      )}
    </Card>
  );
};

export default ScheduleCard;
