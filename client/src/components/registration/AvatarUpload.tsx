// client/src/components/registration/AvatarUpload.tsx
import { useRef, useState } from 'react';
import { Upload, User } from 'lucide-react';

interface Props {
  onFileSelect: (file: File) => void;
}

export default function AvatarUpload({ onFileSelect }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return; // 5MB max
    setPreview(URL.createObjectURL(file));
    onFileSelect(file);
  };

  const trigger = () => inputRef.current?.click();

  return (
    <div className="flex items-center gap-4 mb-5">
      {/* Preview circle */}
      <button
        type="button"
        onClick={trigger}
        className="relative w-[72px] h-[72px] rounded-full bg-gray-800 border-2 border-dashed border-gray-600 hover:border-orange-500 flex items-center justify-center overflow-hidden shrink-0 transition-colors group"
        title="Upload profile photo"
      >
        {preview ? (
          <img src={preview} alt="Profile preview" className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <User size={28} className="text-gray-500 group-hover:text-gray-400 transition-colors" strokeWidth={1.5} />
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handleChange}
          className="sr-only"
          aria-label="Upload profile picture"
        />
      </button>

      {/* Meta */}
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-white">Profile photo</span>
        <span className="text-xs text-gray-500">JPG, PNG up to 5 MB</span>
        <button
          type="button"
          onClick={trigger}
          className="inline-flex items-center gap-1 text-xs font-medium text-orange-500 hover:bg-orange-500/10 rounded px-1.5 py-0.5 mt-1 transition-colors w-fit"
        >
          <Upload size={12} />
          Upload photo
        </button>
      </div>
    </div>
  );
}
