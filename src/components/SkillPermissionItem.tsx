import React from 'react';

interface SkillPermissionItemProps {
  label: string;
  desc: string;
  isEnabled: boolean;
  onToggle: () => void;
  isLast?: boolean;
}

export function SkillPermissionItem({
  label,
  desc,
  isEnabled,
  onToggle,
  isLast = false,
}: SkillPermissionItemProps) {
    return (
      <div 
        className={`px-5 py-3 flex items-center justify-between ${!isLast ? 'border-b border-white/[0.03]' : ''} transition-all duration-300 hover:bg-white/[0.05] hover:border-white/[0.08] cursor-pointer group`}
        onClick={onToggle}
      >
        <div className="flex flex-col gap-0.5 pr-4">
          <span className="text-[13px] text-zinc-200 font-bold tracking-wide group-hover:text-white transition-colors">{label}</span>
          <span className="text-[10px] text-zinc-500 font-medium group-hover:text-zinc-300 transition-colors">{desc}</span>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          aria-pressed={isEnabled}
          aria-label={`Toggle ${label}`}
          title={`Toggle ${label}`}
          className={`w-10 h-6 rounded-full transition-all duration-300 flex items-center shrink-0 cursor-pointer ${isEnabled ? 'bg-[#d0a78b] shadow-[0_0_10px_rgba(208,167,139,0.3)]' : 'bg-zinc-800'}`}
        >
          <span className={`block w-4.5 h-4.5 rounded-full bg-white transition-all duration-300 shadow-md ${isEnabled ? 'ml-[18px]' : 'ml-[3px]'}`} />
        </button>
      </div>
    );
}
