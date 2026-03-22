import React, { useState } from 'react';

interface Step3AccountTypeProps {
  onNext: (accountData: { accountType: string; serviceInterests: string[] }) => void;
  onBack: () => void;
}

const serviceCategories = [
  { id: 'handyman', label: 'Handyman Services', icon: '🔧', desc: 'General repairs, assembly, mounting' },
  { id: 'plumbing', label: 'Plumbing', icon: '🚿', desc: 'Pipe repairs, fixture installation, drain cleaning' },
  { id: 'electrical', label: 'Electrical', icon: '⚡', desc: 'Wiring, outlet installation, lighting' },
  { id: 'landscaping', label: 'Landscaping', icon: '🌿', desc: 'Lawn care, garden maintenance, tree trimming' },
  { id: 'cleaning', label: 'Cleaning', icon: '🧹', desc: 'Deep cleaning, regular maintenance, move-in/out' },
  { id: 'moving', label: 'Moving & Hauling', icon: '📦', desc: 'Furniture moving, junk removal, deliveries' },
  { id: 'painting', label: 'Painting', icon: '🎨', desc: 'Interior/exterior painting, staining, touch-ups' },
  { id: 'tools', label: 'Tool Rental', icon: '🛠️', desc: 'Rent tools from local providers' },
];

export default function Step3AccountType({ onNext, onBack }: Step3AccountTypeProps) {
  const [accountType, setAccountType] = useState<string>('residential');
  const [serviceInterests, setServiceInterests] = useState<string[]>([]);

  const toggleService = (id: string) => {
    setServiceInterests((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  };

  const handleNext = () => {
    onNext({ accountType, serviceInterests });
  };

  return (
    <div className="max-w-2xl mx-auto">
      <h2 className="text-2xl font-bold text-gray-800 mb-2">Account Setup</h2>
      <p className="text-gray-600 mb-6 text-sm">Tell us about how you plan to use OxSteed.</p>

      {/* Account Type Selection */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-3">Account Type</label>
        <div className="grid grid-cols-2 gap-3">
          {[
            { value: 'residential', label: 'Residential', desc: 'Home services for my property' },
            { value: 'commercial', label: 'Commercial', desc: 'Business or commercial property' },
          ].map((type) => (
            <button
              key={type.value}
              type="button"
              onClick={() => setAccountType(type.value)}
              className={`p-4 border-2 rounded-lg text-left transition ${
                accountType === type.value
                  ? 'border-blue-600 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <span className="font-semibold text-gray-800 block">{type.label}</span>
              <span className="text-sm text-gray-500">{type.desc}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Service Interests */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          What services are you interested in?
        </label>
        <p className="text-xs text-gray-500 mb-3">Select all that apply (optional — helps us personalize your experience)</p>
        <div className="grid grid-cols-2 gap-2">
          {serviceCategories.map((svc) => (
            <button
              key={svc.id}
              type="button"
              onClick={() => toggleService(svc.id)}
              className={`flex items-start p-3 border rounded-lg text-left transition text-sm ${
                serviceInterests.includes(svc.id)
                  ? 'border-blue-600 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <span className="text-xl mr-2">{svc.icon}</span>
              <div>
                <span className="font-medium text-gray-800 block">{svc.label}</span>
                <span className="text-xs text-gray-500">{svc.desc}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Navigation */}
      <div className="flex justify-between">
        <button
          type="button"
          onClick={onBack}
          className="px-6 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition"
        >
          Back
        </button>
        <button
          type="button"
          onClick={handleNext}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
        >
          Continue
        </button>
      </div>
    </div>
  );
}
