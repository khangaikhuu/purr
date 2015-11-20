Design Questions
================

Questions and constraints that move the design of Purr forward are documented
here.


## Workflow

- It should be possible for someone to change part of the system, while it's
  running, and see their changes right away, without any restart, data or state
  loss. This takes care of providing a workflow like PHP's.

- It should be possible for someone to test different changes. Essentially, this
  would require the system to act like a VCS specifically for program
  components, allowing safe experimentation in branches and rollbacks.


## Safety / Correctness

- It should only be possible for someone to do something they're explicitly
  given access to. (OCS)

- Code should follow from data shapes.

- Components should program to interfaces, not concrete representations
  (future-proofing).


## Evolution

- There should be language support for evolving it (by the user, and by the
  language itself).
