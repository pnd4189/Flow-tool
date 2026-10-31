import React from 'react';

export interface PanelProps {
  title?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}

export const Panel: React.FC<PanelProps> = ({
  title,
  action,
  children,
  className = '',
  bodyClassName = '',
}) => {
  return (
    <div className={`bg-[#141417] border border-[#26262b] rounded-lg overflow-hidden flex flex-col ${className}`}>
      {title && (
        <div className="h-8 px-3 bg-[#18181d] border-b border-[#26262b] flex items-center justify-between flex-shrink-0">
          <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#ececef] flex items-center gap-1.5">
            {title}
          </div>
          {action && <div className="flex items-center gap-1">{action}</div>}
        </div>
      )}
      <div className={`p-3 flex-1 overflow-y-auto ${bodyClassName}`}>{children}</div>
    </div>
  );
};
