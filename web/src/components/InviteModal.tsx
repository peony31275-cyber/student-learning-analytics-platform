import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, qk } from '../services/api';
import type { StudentDetail } from '../types/api';
import { Field, FormError, Modal } from './ui';

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

/** Staff: create (or replace) a student's one-time activation link. */
export function InviteModal({ student, onClose }: { student: StudentDetail; onClose: () => void }) {
  const qc = useQueryClient();
  const pending = student.account.pendingInvite;
  const [replaced, setReplaced] = useState(false);
  const [copied, setCopied] = useState(false);
  const create = useMutation({
    mutationFn: () => api.students.createInvite(student.id),
    onMutate: () => setReplaced(!!pending),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.student(student.id) }),
  });
  const invite = create.data;

  return (
    <Modal title="Activation invite" onClose={onClose}>
      <div className="stack">
        {!invite && (
          <>
            <p style={{ margin: 0 }}>
              Create a personal activation link for {student.firstName} {student.lastName}
              {student.email ? ` (${student.email})` : ''}. It works once, expires after 24 hours,
              and lets the student choose their own password.
            </p>
            {pending && (
              <div className="alert-box info">
                A link created {dateTime(pending.createdAt)} is valid until{' '}
                {dateTime(pending.expiresAt)}. Creating a new one replaces it.
              </div>
            )}
            {!student.email && (
              <div className="alert-box error">
                Add a school email to this student (Edit) before inviting them.
              </div>
            )}
            <FormError error={create.error} />
          </>
        )}
        {invite && (
          <>
            <div className="alert-box success" role="status">
              Activation link created, valid until {dateTime(invite.expiresAt)}.
              {replaced && ' The previous link no longer works.'}
            </div>
            <div className="alert-box info">
              <strong>Development only:</strong> in production this link would be emailed to the
              student and never shown here. Open it in a private window to see the student’s view.
            </div>
            <Field label="Activation link" htmlFor="invite-link">
              <input
                id="invite-link"
                className="input"
                value={invite.activationUrl}
                readOnly
                onFocus={(e) => e.currentTarget.select()}
              />
            </Field>
          </>
        )}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>
            {invite ? 'Done' : 'Cancel'}
          </button>
          {invite ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() =>
                void navigator.clipboard
                  ?.writeText(invite.activationUrl)
                  .then(() => setCopied(true))
              }
            >
              {copied ? 'Copied' : 'Copy link'}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              disabled={create.isPending || !student.email}
              onClick={() => create.mutate()}
            >
              {pending ? 'Create new link' : 'Create link'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
