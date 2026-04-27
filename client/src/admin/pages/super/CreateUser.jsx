import { useNavigate } from 'react-router-dom';
import { ArrowLeft, UserPlus } from 'lucide-react';
import CreateUserForm from '../../../components/CreateUserForm';

export default function CreateUser() {
  const navigate = useNavigate();

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <button
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-gray-200 mb-4"
      >
        <ArrowLeft size={14} />
        Back
      </button>

      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 rounded-md bg-orange-900/40 border border-orange-800">
          <UserPlus size={20} className="text-orange-400" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-gray-100">Create user</h1>
          <p className="text-sm text-gray-400">
            Provision a new account on behalf of a customer, helper, or broker.
            All fields are recorded in the audit log.
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-gray-800 bg-gray-950 p-6">
        <CreateUserForm
          onCreated={(user) => {
            if (user?.id) {
              navigate(`/admin/users/${user.id}`);
            }
          }}
          onCancel={() => navigate(-1)}
        />
      </div>
    </div>
  );
}
