#!/usr/bin/env python3
"""Publish a team's brain as a team repository: the plugin (built by brain/plugin/build.py) plus the team's shared
knowledge folder, in one git repository people clone (paas-team add) and Claude Code installs from
(claude plugin marketplace add <url>).
  publish.py <team> --to <dir>        build into <dir> (git init on first use), commit the new plugin
  publish.py <team> --to <git-url>    clone the team repository (an empty GitLab project is fine), rebuild the
                                      plugin, commit, push; the url is recorded as the team's knowledge remote
  publish.py --all --to <parent-dir>  every team of brain/teams into <parent>/<team>
           --only-missing  (with --all) only the teams not there yet: an existing team repository is never changed
                           (install-shared.sh: a team's repository is its own; update one on purpose with publish.py <team>)
  options: --remote <url>  record another url as the remote members clone and push to
           --no-hooks      the plugin without hooks (a VM whose hooks are managed settings)
           --no-commit     leave the files uncommitted
           --force         replace a plugin that members changed from the Brain tab (their edits are dropped)
Layout of a team repository:
  .claude-plugin/marketplace.json   paas-brain-<team>/ (the plugin, rebuilt on every publish; its servers and remote carried over)
  knowledge/{notes,runbooks,captures,incidents}/ + notes.md, environment.md, tool-map.md   (the team's memory, shared by every member)
  rules/main.md, persona.md, storage.md, coding.md   the team's rules (created once from the brain's, then the team's own:
                                    linked into every member's ~/.claude/brain; a publish never changes them)
  paas-brain-<team>/.mcp.json and team.json   the only copy of the team's MCP servers (connected ones with address and
             token: the owner's decision, readable by everyone in the project; use read-only tokens and rotate them when
             someone leaves) and of its definition (lists, remote, servers still waiting for an address or token)
  README.md   .gitignore
  bin/paas-team                     the team tool, so a clone of this repository is a complete install source
  join.sh, join.ps1                 a new machine (Linux / macOS, Windows) joins the team: certificate, docs check, plugin
  check.py + .gitlab-ci.yml         the repository's own gate (JSON, plugin shape, skills, no secrets in knowledge, caps)
Standard library, Python 3.9."""
import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
BRAIN = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(BRAIN, "plugin"))
import build  # noqa: E402  (brain/plugin/build.py)
import importlib.machinery  # noqa: E402
import importlib.util  # noqa: E402

_spec = importlib.util.spec_from_loader("paas_team", importlib.machinery.SourceFileLoader(
    "paas_team", os.path.join(BRAIN, "claude", "tools", "paas-team")))
paas_team = importlib.util.module_from_spec(_spec)       # one implementation of the plugin's .mcp.json and the version fingerprint
_spec.loader.exec_module(paas_team)
CERTS = ("/opt/paas/paas-ui.crt", "/etc/paas/market/paas-ui.crt")   # the VM's certificate, for laptops' docs-local bridge

IGNORE = "*.bak\n.DS_Store\n._*\n__pycache__/\n"
# two members who add notes at the same moment both append at the end of the same file: a plain merge calls that a
# conflict and the second push stops. git's built-in union merge keeps both sides' lines; the generated INDEX.md keeps
# the old rule (the notes hook rebuilds it when it conflicts)
ATTRIBUTES = ("knowledge/*.md merge=union\nknowledge/**/*.md merge=union\nknowledge/INDEX.md -merge\n")
CATALOG = os.path.join(BRAIN, "marketplace", "mcp.json")        # the servers' shapes (HOST / TOKEN placeholders)


# MCP servers renamed in the brain: old name -> new name (the team's filled-in entry moves to the new name at the next publish)
RENAMED = {"ucsc": "ucs-central"}

def git(repo, *args, check=False, timeout=120):
    r = subprocess.run(["git", "-C", repo] + list(args), capture_output=True, text=True, timeout=timeout,
                       env=dict(os.environ, GIT_TERMINAL_PROMPT="0", **paas_team.identity(repo)))
    if check and r.returncode:
        sys.exit(f"publish.py: git {' '.join(args)} failed: {(r.stderr or r.stdout).strip()[-300:]}")
    return r


def is_url(s):
    return "://" in s or (":" in s and not os.path.exists(s) and not s.startswith((".", "/")))


def readme(team, remote):
    t = team
    url = remote or "<this repository's url>"
    n = t["name"]
    return (f"# Team brain: {t.get('title', n)}\n\n{t.get('description', '')}\n\n"
            "## Install (any machine with Claude Code and git)\n\n"
            "From a clone of this repository, one command trusts the VM's certificate, checks the docs service, installs the "
            "plugin and checks that Claude Code connects the docs:\n\n"
            f"```sh\ngit clone {url} brain-{n}\nsh brain-{n}/join.sh                                   # Linux / macOS\n"
            f"powershell -ExecutionPolicy Bypass -File .\\brain-{n}\\join.ps1   # Windows\n```\n"
            f"Or by hand: `claude plugin marketplace add {url}`, `claude plugin install paas-brain-{n}@paas-brain-{n}`, and the VM's "
            f"certificate (`paas-brain-{n}/lib/paas-ui.crt`) in this machine's trust store. Then `claude`.\n"
            "The first session sets the team up: it clones this repository into `~/.claude/brain/teams/" + n + "`, links the "
            "memory files and the team's `rules/` into it (one import line in your `~/.claude/CLAUDE.md`) "
            "and installs `paas-team`. From then on every saved note is committed and pushed here, every session start pulls, "
            "and a new plugin version published here is applied at the next session start.\n"
            f"No GitLab from that machine? Copy a clone of this repository over and give its folder to the first command "
            f"(`claude plugin marketplace add ./brain-{n}`): the plugin runs from it and the knowledge stays in it.\n\n"
            "## What is here\n\n"
            f"- `paas-brain-{n}/`: the brain as a Claude Code plugin ({len(t['skills'])} skills, {len(t['agents'])} agents, "
            f"version {t['version']}); rebuilt only by `brain/teams/publish.py` from the storage-mcp-servers repository, never edited here\n"
            "- `knowledge/`: the team's shared memory, written by every member's brain and synced through this repository: "
            "notes.md (the catalog loaded every session), environment.md, tool-map.md, notes/<topic>.md, runbooks/ (tested "
            "procedures: pre-checks, steps, verification, rollback), captures/, incidents/\n"
            "- `rules/`: the team's rules (`main.md` = the golden rules, `persona.md`, `storage.md`, `coding.md`), linked into every "
            "member's `~/.claude/brain`. Edit them here (commit and push by hand, or the Brain tab's team editor); Claude cannot "
            "change them, the notes hook never commits them and a new publish never overwrites them\n"
            f"- `paas-brain-{n}/.mcp.json` and `team.json`: the only copy of the team's MCP servers (address and token: every "
            "member's Claude connects them) and of the team's definition (lists, remote, servers still waiting for an address "
            "or a token); change them with the Brain tab's team editor\n"
            "- `check.py` runs in CI (`.gitlab-ci.yml`) and refuses a push that carries a credential or breaks the notes format\n\n"
            f"`paas-team` shows the state, `paas-team use <other>` switches team, `paas-team off` leaves the teams. "
            "The docs library is not in this repository: the plugin's `docs-http` is the VM's docs service for this team (address and "
            "token come with the plugin; the VM's port open from this machine, its certificate trusted); on the VM the plugin's "
            "`docs-local` serves the same library. The brain's session hooks and `docs-local` need python3; `docs-http` does not.\n"
            f"On the VM: `paas-team use {n}` (or the Brain tab). On a laptop add `\"env\": {{\"ENABLE_TOOL_SEARCH\": \"true\"}}` to `~/.claude/settings.json`: "
            "the team's MCP tool schemas then load when a task needs them instead of into every session.\n")



def shape(cat, name):
    """the catalog entry of a server: its own, or the one its name extends ("commvault-env2" is a "commvault": a team with
    one server per CommCell, cluster or site names each instance)"""
    if name in cat:
        return cat[name]
    base = max((k for k in cat if name.startswith(k + "-")), key=len, default="")
    return cat.get(base)

def publish(team, dest, remote=None, hooks=True, commit=True, force=False, docs_search=None, docs_token=None):
    """build the team into the repository at dest (a directory); returns the plugin's team.json data. docs_search: the VM's
    docs-search url (?team= is added), docs_token its token: written into the plugin's .mcp.json, so laptops reach the library."""
    os.makedirs(dest, exist_ok=True)
    if not os.path.isdir(os.path.join(dest, ".git")):
        git(dest, "init", "-q", "-b", "main", check=True)
    plugdir = os.path.join(dest, "paas-brain-" + team)
    if os.path.isdir(os.path.join(dest, ".git")) and os.path.isdir(plugdir) and not force:
        # commits touching the plugin that publish.py did not make: someone changed a team skill from the Brain tab (the
        # change is live for the whole team). Port it into brain/teams/<team> or brain/claude first, or pass --force.
        # A commit that only changed the team's servers or title (.mcp.json, team.json, the version) is not one: publish
        # carries those over.
        kept = {f"paas-brain-{team}/{x}" for x in (".mcp.json", "team.json", ".claude-plugin/plugin.json")}
        r = git(dest, "log", "--format=%x00%h %s", "--name-only", "--", "paas-brain-" + team)
        edits = []
        for block in (r.stdout.split("\0")[1:] if r.returncode == 0 else []):
            lines = [l for l in block.splitlines() if l.strip()]
            head, files = lines[0], lines[1:]
            if (head.split(" ", 1) + [""])[1].startswith(f"team {team}: plugin") or (files and set(files) <= kept):
                continue
            edits.append(head)
        if edits:
            sys.exit(f"publish.py: the team repository holds {len(edits)} change(s) to the plugin made outside publish.py "
                     f"(Brain tab edits):\n  " + "\n  ".join(edits[:10]) + "\nPort them into brain/teams/" + team
                     + " (git -C <repo> show <sha>) or re-run with --force to drop them.")
    # one copy of everything, inside the plugin (the only part Claude Code installs): the team's servers live in its .mcp.json
    # (connected) and team.json (mcp_pending: still without an address or token), the remote in team.json. Rebuilding the
    # plugin replaces it, so they are read first; a repository from before this layout has them in mcp.json / team.json at
    # its root: read from there once and the root files removed.
    first = not os.path.exists(os.path.join(plugdir, ".mcp.json")) and not os.path.exists(os.path.join(dest, "mcp.json"))
    servers = {} if first else paas_team.load_servers(plugdir, dest)
    old_remote = paas_team.jload(os.path.join(plugdir, "team.json")).get("remote") or paas_team.jload(os.path.join(dest, "team.json")).get("remote")
    plug = build.build(dest, team, hooks)
    pj = os.path.join(plug, "team.json")
    t = paas_team.jload(pj)
    if first:                                                          # made once from the catalog; the team editor fills it
        cat = json.load(open(CATALOG)) if os.path.exists(CATALOG) else {}
        servers = {n: json.loads(json.dumps(shape(cat, n)["server"]).replace("TEAM", team)) for n in t.get("mcp", [])
                   if shape(cat, n) and n != "docs-local"}
    for old, new in RENAMED.items():                                  # a server renamed in the brain keeps its address and token
        if old in servers and new not in servers:
            servers[new] = servers.pop(old)
    if docs_search:                                                    # the VM's docs service: every member's docs-local reaches the library
        url = docs_search if "?team=" in docs_search else docs_search + "?team=" + team
        servers["docs-search"] = {"type": "http", "url": url, **({"headers": {"Authorization": "Bearer " + docs_token}} if docs_token else {})}
    if remote or old_remote:                                           # the plugin's session-start hook clones the team from it
        t["remote"] = remote or old_remote
    paas_team.save_servers(plug, servers, t)                           # the filled-in servers into .mcp.json, the rest into team.json
    with open(pj, "w") as f:
        json.dump(t, f, indent=2, sort_keys=True)
        f.write("\n")
    for cert in CERTS:
        if os.path.isfile(cert):
            shutil.copy(cert, os.path.join(plug, "lib", "paas-ui.crt"))
            break
    # Claude Code gives a user a new copy of a plugin from a git-hosted marketplace only when plugin.json's version changes:
    # the version is the library version plus a fingerprint of the plugin's content (paas-team's rule), so every publish
    # with a change is one
    paas_team.bump_version(plug)
    t = paas_team.jload(pj)
    for old in ("mcp.json", "team.json"):                              # one copy: the root files of an older layout go
        if os.path.isfile(os.path.join(dest, old)):
            os.remove(os.path.join(dest, old))
    k = os.path.join(dest, "knowledge")
    for d in ("notes", "runbooks", "captures", "incidents"):
        os.makedirs(os.path.join(k, d), exist_ok=True)
        keep = os.path.join(k, d, ".keep")
        if not os.listdir(os.path.join(k, d)):
            open(keep, "w").close()
    for f in ("tool-map.md", "notes.md", "environment.md"):           # the team's memory starts from the templates, once
        if not os.path.exists(os.path.join(k, f)):
            shutil.copy(os.path.join(plug, "brain", f), os.path.join(k, f))
    # the team's rules start from the brain's, once; from then on they are the team's: an existing file is never changed,
    # a newer brain version is only reported (the team merges what it wants by hand)
    rdir = os.path.join(dest, "rules")
    os.makedirs(rdir, exist_ok=True)
    newer = []
    for name, tpl in paas_team.RULES:
        own, src = os.path.join(rdir, name), os.path.join(plug, "brain", tpl)
        if not os.path.exists(own):
            shutil.copy(src, own)
        elif open(own, encoding="utf-8").read() != open(src, encoding="utf-8").read():
            newer.append(f"rules/{name} (brain: {os.path.relpath(src, dest)})")
    if newer:
        print(f"team {team}: kept the team's own " + ", ".join(newer) + "; compare with git diff --no-index if you want the brain's changes")
    with open(os.path.join(dest, ".gitignore"), "w") as f:
        f.write(IGNORE)
    with open(os.path.join(dest, ".gitattributes"), "w") as f:
        f.write(ATTRIBUTES)
    with open(os.path.join(dest, "README.md"), "w") as f:
        f.write(readme(t, t.get("remote")))
    for stale in ("install-team.sh",):                                 # earlier publishes wrote it; the plugin install replaced it
        if os.path.exists(os.path.join(dest, stale)):
            os.remove(os.path.join(dest, stale))
    for src, dst in (("team-join.sh", "join.sh"), ("team-join.ps1", "join.ps1")):   # a new machine joins with one command
        shutil.copy(os.path.join(HERE, src), os.path.join(dest, dst))
    os.chmod(os.path.join(dest, "join.sh"), 0o755)
    shutil.copy(os.path.join(HERE, "team-check.py"), os.path.join(dest, "check.py"))      # the repository's own CI gate
    os.chmod(os.path.join(dest, "check.py"), 0o755)
    if not os.path.exists(os.path.join(dest, ".gitlab-ci.yml")):
        shutil.copy(os.path.join(HERE, "team-gitlab-ci.yml"), os.path.join(dest, ".gitlab-ci.yml"))
    os.makedirs(os.path.join(dest, "bin"), exist_ok=True)
    shutil.copy(os.path.join(BRAIN, "claude", "tools", "paas-team"), os.path.join(dest, "bin", "paas-team"))
    os.chmod(os.path.join(dest, "bin", "paas-team"), 0o755)
    if commit:
        git(dest, "add", "-A")
        git(dest, "commit", "-q", "-m", f"team {team}: plugin {t['version']}")   # nothing new: exits 1, fine
    return t


def publish_url(team, url, hooks, commit, force=False, docs_search=None, docs_token=None):
    tmp = tempfile.mkdtemp(prefix="paas-team-")
    try:
        r = subprocess.run(["git", "clone", "-q", "--", url, tmp], capture_output=True, text=True, timeout=300,
                           env=dict(os.environ, GIT_TERMINAL_PROMPT="0"))
        if r.returncode:
            sys.exit(f"publish.py: cannot clone {url}: {r.stderr.strip()[-300:]}")
        if git(tmp, "rev-parse", "--verify", "-q", "HEAD").returncode:      # an empty project
            git(tmp, "checkout", "-q", "-b", "main")
        r = git(tmp, "rev-parse", "--abbrev-ref", "HEAD")
        branch = r.stdout.strip() if r.returncode == 0 and r.stdout.strip() not in ("", "HEAD") else "main"   # its default (main, master...)
        t = publish(team, tmp, remote=url, hooks=hooks, commit=commit, force=force, docs_search=docs_search, docs_token=docs_token)
        if commit:
            r = git(tmp, "push", "-u", "origin", "HEAD:" + branch, timeout=300)
            if r.returncode:
                out = (r.stderr or r.stdout).strip()
                reason = "\n  ".join(l.strip() for l in out.splitlines() if l.startswith("remote:") or l.startswith("!") or l.startswith("error:"))
                sys.exit("publish.py: push failed:\n  " + (reason or out[-300:]))      # GitLab's own sentence, not only git's summary
        print(f"team {team}: plugin {t['version']} ({len(t['skills'])} skills, {len(t['agents'])} agents) pushed to {url} (branch {branch})")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main():
    args = sys.argv[1:]
    team = dest = remote = None
    hooks = commit = True
    everything = force = only_missing = False
    docs_search = docs_token = None
    while args:
        a = args.pop(0)
        if a == "--to" and args:
            dest = args.pop(0)
        elif a == "--docs-search" and args:
            docs_search = args.pop(0)
        elif a == "--docs-token-file" and args:
            with open(args.pop(0)) as f:
                docs_token = f.read().strip()
        elif a == "--remote" and args:
            remote = args.pop(0)
        elif a == "--all":
            everything = True
        elif a == "--only-missing":
            only_missing = True
        elif a == "--no-hooks":
            hooks = False
        elif a == "--no-commit":
            commit = False
        elif a == "--force":
            force = True
        elif a.startswith("-") or team:
            sys.exit(__doc__)
        else:
            team = a
    if not dest or not (team or everything) or (team and everything):
        sys.exit(__doc__)
    if everything:
        for name in build.team_names():
            there = os.path.join(os.path.abspath(dest), name)
            if only_missing and os.path.isdir(os.path.join(there, ".git")):
                print(f"team {name}: already in {there}, left as it is")
                continue
            t = publish(name, os.path.join(os.path.abspath(dest), name), remote=remote, hooks=hooks, commit=commit, force=force,
                        docs_search=docs_search, docs_token=docs_token)
            print(f"team {name}: plugin {t['version']} ({len(t['skills'])} skills, {len(t['agents'])} agents) in {os.path.join(dest, name)}")
        return
    if is_url(dest):
        publish_url(team, dest, hooks, commit, force, docs_search, docs_token)
    else:
        t = publish(team, os.path.abspath(dest), remote=remote, hooks=hooks, commit=commit, force=force, docs_search=docs_search, docs_token=docs_token)
        print(f"team {team}: plugin {t['version']} ({len(t['skills'])} skills, {len(t['agents'])} agents) in {dest}")


if __name__ == "__main__":
    main()
