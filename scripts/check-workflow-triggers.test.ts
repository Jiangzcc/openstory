import { describe, expect, it } from 'vitest';
import { rejectWorkflowTriggers } from './check-workflow-triggers';

describe('workflow trigger safety', () => {
  it.each([
    'on:\n  push:\n  pull_request:\njobs:\n  test: {}',
    "'on':\r\n  pull_request:\r\njobs:\r\n  test: {}",
    '"on": [push, pull_request]\njobs: {}',
    'on: workflow_dispatch\njobs: {}',
    'on:\n  push: # pull_request_target is forbidden\njobs: {}',
    'on: push\njobs:\n  test:\n    name: pull_request_target',
  ])(
    'allows ordinary triggers and ignores comments or job content (%s)',
    (source) => {
      expect(rejectWorkflowTriggers(source)).toBeNull();
    }
  );

  it.each([
    'on:\n  pull_request_target:\n    branches: [main]\njobs: {}',
    "'on':\r\n  pull_request_target:\r\njobs: {}",
    '"on": [push, pull_request_target]\njobs: {}',
    'on: pull_request_target\njobs: {}',
  ])(
    'rejects unsafe triggers regardless of quotes or line endings (%s)',
    (source) => {
      expect(rejectWorkflowTriggers(source)).toContain('not allowed');
    }
  );

  it.each([
    'name: no trigger\njobs: {}',
    '# on: push\njobs: {}',
    'name: unsupported indentation\n  on: push\njobs: {}',
  ])('rejects an absent or unsupported trigger block (%s)', (source) => {
    expect(rejectWorkflowTriggers(source)).toContain('unsupported YAML format');
  });
});
