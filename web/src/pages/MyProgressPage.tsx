import { Card, EmptyState, PageHeader } from '../components/ui';
import { useAuth } from '../hooks/useAuth';
import { StudentInsights } from './StudentDetailPage';

export function MyProgressPage() {
  const { user } = useAuth();
  if (!user?.studentId) {
    return (
      <Card>
        <EmptyState title="Your account is not linked to a student record">
          Contact your school administrator.
        </EmptyState>
      </Card>
    );
  }
  return (
    <>
      <PageHeader
        title={`Hi, ${user.firstName}`}
        subtitle="Your grades, attendance and personalised suggestions"
      />
      <StudentInsights studentId={user.studentId} audience="student" />
    </>
  );
}
