import React, { useState, useEffect } from 'react';
import { getTasks, type Task } from '../../services/api';
import { format, parseISO } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { Search, Loader2, Calendar, CheckCircle2, Circle } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import TaskDetailModal from './TaskDetailModal';
import '../../styles/Schedule.css';

const SearchTasks: React.FC = () => {
  const [query, setQuery] = useState('');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [completedFilter, setCompletedFilter] = useState<boolean | undefined>(undefined);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const limit = 20;

  const handleSearch = async (reset = false) => {
    setLoading(true);
    try {
      const offset = reset ? 0 : page * limit;
      const response = await getTasks({
        q: query,
        completed: completedFilter,
        limit,
        offset,
        sortBy: 'startTime',
        order: 'desc'
      });
      
      if (reset) {
        setTasks(response.tasks);
        setPage(0);
      } else {
        setTasks(prev => [...prev, ...response.tasks]);
      }
      setTotal(response.total);
    } catch (error) {
      console.error('Failed to search tasks', error);
    } finally {
      setLoading(false);
    }
  };

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      handleSearch(true);
    }, 500);
    return () => clearTimeout(timer);
  }, [query, completedFilter]);

  const loadMore = () => {
    setPage(p => p + 1);
    // handleSearch will use the new page in next render? No, state update is async.
    // I should call fetch with new offset directly or use useEffect on page change.
    // But I used reset logic in handleSearch.
    // Let's just call fetch directly.
    const nextPage = page + 1;
    setLoading(true);
    getTasks({
        q: query,
        completed: completedFilter,
        limit,
        offset: nextPage * limit,
        sortBy: 'startTime',
        order: 'desc'
    }).then(response => {
        setTasks(prev => [...prev, ...response.tasks]);
        setTotal(response.total);
        setLoading(false);
    }).catch(e => {
        console.error(e);
        setLoading(false);
    });
  };

  return (
    <>
      <Card className="schedule-container search-container">
        <CardHeader className="schedule-header">
          <CardTitle>搜索任务</CardTitle>
        </CardHeader>
        <CardContent className="search-content">
          <div className="search-controls">
            <div className="search-input-container">
              <Search size={18} className="search-icon" />
              <Input 
                placeholder="搜索任务名称、描述或地点..." 
                value={query} 
                onChange={e => setQuery(e.target.value)}
              />
            </div>
            <div className="filter-group">
              <button 
                className={`filter-btn ${completedFilter === undefined ? 'active' : ''}`}
                onClick={() => setCompletedFilter(undefined)}
              >
                全部
              </button>
              <button 
                className={`filter-btn ${completedFilter === false ? 'active' : ''}`}
                onClick={() => setCompletedFilter(false)}
              >
                未完成
              </button>
              <button 
                className={`filter-btn ${completedFilter === true ? 'active' : ''}`}
                onClick={() => setCompletedFilter(true)}
              >
                已完成
              </button>
            </div>
          </div>

          <div className="task-list">
            {tasks.length === 0 && !loading ? (
              <div className="empty-state" style={{ textAlign: 'center', padding: '40px', color: '#888' }}>
                未找到匹配的任务
              </div>
            ) : (
              tasks.map(task => (
                <div 
                  key={task.id} 
                  className={`task-item importance-${task.importance || 'normal'} ${task.completed ? 'completed' : ''}`}
                  onClick={() => setSelectedTask(task)}
                >
                  <div className="task-status-icon">
                    {task.completed ? <CheckCircle2 size={20} className="text-green-500" /> : <Circle size={20} className="text-gray-400" />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="task-name" style={{ fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{task.name}</div>
                    <div className="task-meta" style={{ fontSize: '12px', color: '#666', display: 'flex', gap: '10px', marginTop: '4px' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                        <Calendar size={12} />
                        {format(parseISO(task.startTime), 'yyyy-MM-dd HH:mm', { locale: zhCN })}
                      </span>
                      {task.location && <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>📍 {task.location}</span>}
                    </div>
                    {task.description && (
                        <div className="task-desc" style={{ fontSize: '12px', color: '#888', marginTop: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {task.description}
                        </div>
                    )}
                  </div>
                </div>
              ))
            )}
            
            {loading && <div className="loading-indicator" style={{ textAlign: 'center', padding: '20px' }}><Loader2 className="spin" style={{ display: 'inline' }} /> 加载中...</div>}
            
            {tasks.length < total && !loading && (
              <div style={{ textAlign: 'center', marginTop: '20px' }}>
                <Button variant="ghost" onClick={loadMore}>加载更多</Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <TaskDetailModal
        isOpen={!!selectedTask}
        onClose={() => setSelectedTask(null)}
        task={selectedTask}
        onTaskUpdated={() => handleSearch(true)}
      />
    </>
  );
};

export default SearchTasks;
