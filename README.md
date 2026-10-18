# pi-cluster-gitops

Everything for a 3-node Raspberry Pi Kubernetes cluster: how the cluster
itself is built (kubeadm, from bare Pis) and the GitOps source of truth
ArgoCD syncs onto it once it's up.

- [`docs/kubeadm-install-guide.md`](docs/kubeadm-install-guide.md) — building
  the cluster from bare Pis: kubeadm, stacked etcd, kube-vip, Cilium. Start
  here if there is no cluster yet; `scripts/` holds the per-node prep it uses.
- [`docs/networking-explained.md`](docs/networking-explained.md) — beginner's
  guide to how a request reaches an app: MetalLB, Envoy Gateway and Cilium,
  with analogies.
- [`docs/public-access-explained.md`](docs/public-access-explained.md) —
  beginner's guide to the public path: Namecheap, Cloudflare DNS, the
  tunnel and its route, and where secrets and certificates fit.
- [`docs/architecture.md`](docs/architecture.md) — repo layout, how to add apps
  and platform components.
- [`docs/helm-workflow.md`](docs/helm-workflow.md) — the local Helm loop, and a
  map of which Helm concept is demonstrated in which file.
- [`docs/rebuild.md`](docs/rebuild.md) — rebuilding the Pis from scratch: what
  to back up, hardware and HA decisions, and the verification checklist.
- [`docs/cloudflare-1password-setup.md`](docs/cloudflare-1password-setup.md) —
  the manual, outside-git steps in Cloudflare, Namecheap and 1Password that
  public exposure and cert-manager depend on.

## Repo layout

```
bootstrap/                       one-time, manually-applied root Application
clusters/rpi-cluster/platform/   cluster infrastructure Applications
clusters/rpi-cluster/apps/       workload Applications
apps/                            the Helm chart backing each workload
platform/<component>/            plain CR manifests belonging to a platform Application
scripts/                         per-node OS prep, run before kubeadm (see the install guide)
site/                            source for the resume site image (built by CI)
docs/                            install guide, architecture, external setup
.github/workflows/               multi-arch image build + digest write-back
```

Only `clusters/rpi-cluster` is watched by ArgoCD's root Application —
everything else here is either referenced explicitly by an Application
(`apps/`, `platform/`) or not deployed at all (`scripts/`, `docs/`, `site/`).

## Bootstrapping a fresh cluster

Assumes kubeadm is installed and running on all three Pis — see
[`docs/kubeadm-install-guide.md`](docs/kubeadm-install-guide.md) for that —
with `kubectl`/`helm` pointed at the cluster.

> Rebuilding existing Pis rather than starting fresh? Read
> [`docs/rebuild.md`](docs/rebuild.md) first for what to back up and the
> hardware decisions to make before wiping; OS and cluster formation then
> follow the install guide, not this file.

1. Install ArgoCD via Helm, using the same chart version and values this
   repo uses to manage ArgoCD afterwards:

   ```sh
   helm repo add argo https://argoproj.github.io/argo-helm
   helm repo update

   helm install argocd argo/argo-cd \
     --version 10.6.4 \
     --namespace argocd --create-namespace \
     -f clusters/rpi-cluster/platform/argocd-values.yaml
   ```

2. Create the two hand-made bootstrap Secrets (1Password Connect's
   credentials file and the token ESO uses to reach it) — the only secrets
   that can't come from 1Password, because they're what unlocks it. Commands
   in [`docs/cloudflare-1password-setup.md`](docs/cloudflare-1password-setup.md),
   step 7. Without them Connect, ESO and everything that gets a secret from
   1Password (cloudflared, cert-manager's DNS-01) wait unhealthy.

3. Apply the root Application so ArgoCD starts managing everything in this
   repo, including its own installation:

   ```sh
   kubectl apply -f bootstrap/root-app.yaml
   ```

4. Confirm the Applications show up and sync — fourteen of them: `root`,
   `argocd`, `cilium`, `metallb`, `envoy-gateway`, `local-path-provisioner`,
   `prometheus`, `onepassword-connect`, `external-secrets-operator`,
   `cert-manager`, `cloudflared`, `headlamp`, `kavita`, `resume`:

   ```sh
   kubectl get applications -n argocd
   ```

   `prometheus` is the slow one: it installs the Prometheus Operator CRDs
   first, and on Pi hardware the whole stack can take several minutes to go
   Healthy. `Progressing` is expected for a while.

   `cilium` syncs manually, not automatically — see
   [`docs/architecture.md`](docs/architecture.md#adopting-an-already-running-release-cilium)
   before touching it; it's adopting an already-running release, and an unintended
   values change restarts the CNI on every node at once.

From here, all changes - including upgrading ArgoCD itself - go through
git: edit a manifest, commit, push, let ArgoCD sync.

## What's scaffolded so far

- **ArgoCD**, self-managed via the app-of-apps pattern.
- **Cilium** — the cluster's CNI, adopted from the kubeadm bootstrap install.
- **MetalLB** — LoadBalancer IPs in L2 mode, pool
  `192.168.0.210`–`192.168.0.230`. Needs `ignoreExcludeLB: true` because
  every node is a kubeadm control-plane node — see `docs/architecture.md`.
- **Envoy Gateway** — Gateway API implementation fronting every hostname
  through one shared LoadBalancer IP (replaced Traefik's per-node hostPort
  model).
- **local-path-provisioner** — dynamic `local-path` StorageClass, not
  replicated (a PVC's data lives on whichever node it lands on). A stopgap
  for Longhorn — see `docs/architecture.md`.
- **kube-prometheus-stack** — Prometheus, Grafana, node-exporter and
  kube-state-metrics, tuned down for Pi hardware (Alertmanager off).
- **1Password Connect + External Secrets Operator** — secrets come from the
  1Password vault `K8S` as `ExternalSecret`s; only the two bootstrap
  credentials are made by hand
  ([setup doc](docs/cloudflare-1password-setup.md), step 7).
- **cert-manager** — real Let's Encrypt certificates via Cloudflare DNS-01 for
  the LAN-only `resume.home.juangar.com`, `grafana.home.juangar.com`,
  `headlamp.home.juangar.com` and `books.home.juangar.com`.
- **cloudflared** — Cloudflare Tunnel publishing the resume site at
  **https://juangar.com**, and Kavita at `https://books.juangar.com` behind
  Cloudflare Access, with no open router ports
  ([how it works](docs/public-access-explained.md)).
- **Headlamp** — cluster web UI at `https://headlamp.home.juangar.com`
  (LAN-only). Its own ServiceAccount has no permissions; log in with a
  token — see [Logging in to Headlamp](#logging-in-to-headlamp).
- **Kavita** (`apps/kavita`) — private ebook server and web reader at
  `https://books.home.juangar.com` on the LAN, and `https://books.juangar.com`
  from anywhere behind a Cloudflare Access login. One pod, state on two
  `local-path` PVCs — see [Kavita: books](#kavita-books).
- **`apps/resume`** — the resume site chart, and the reference chart for this
  repo. Heavily commented as a Helm tutorial; copy it for new apps.

The site reads live cluster state from Prometheus through a same-origin nginx
proxy — see [`docs/architecture.md`](docs/architecture.md) for the request
path.

### Where the site is served

| Hostname | Reachable from | HTTPS | How |
| --- | --- | --- | --- |
| **https://juangar.com** | anywhere | Cloudflare's certificate | Cloudflare Tunnel → Envoy — [explained](docs/public-access-explained.md) |
| `https://resume.home.juangar.com` | LAN | Let's Encrypt via cert-manager | Envoy's `https-resume` listener |
| `http://resume.lan` | LAN | – | Envoy's `http` listener |

The LAN names need an `/etc/hosts` entry (or a LAN DNS record) pointing at
the Gateway's IP, `192.168.0.210` — one IP for every hostname, never a node's
own IP. `grafana.lan` / `grafana.home.juangar.com`, `headlamp.lan` /
`headlamp.home.juangar.com` and `books.lan` / `books.home.juangar.com` work
the same way.

### Logging in to Headlamp

Headlamp asks for a token and acts with exactly that token's rights. Three
ServiceAccounts in `platform/headlamp/`:

| Token | Can | How to get it |
| --- | --- | --- |
| `headlamp-viewer` | read (built-in `view`: no Secrets) | long-lived — keep it in 1Password |
| `headlamp-operator` | read + delete pods, rollout restart, scale | long-lived — keep it in 1Password |
| `headlamp-admin` | cluster-admin | short-lived only, minted on demand |

```sh
# long-lived (swap viewer for operator)
kubectl get secret headlamp-viewer-token -n headlamp -o jsonpath='{.data.token}' | base64 -d
# admin, expires on its own
kubectl create token headlamp-admin -n headlamp --duration=1h
```

Use the `https://` name: on `headlamp.lan` the token crosses the LAN in
cleartext. To revoke a long-lived token, delete its Secret; ArgoCD recreates
it with a new one.

### Kavita: books

**First run — do this on the LAN before `books.juangar.com` exists.**
Kavita's *first visitor creates the admin account*, so open
`https://books.home.juangar.com` straight after the first sync:

1. Create the admin account; save it in 1Password (vault `K8S`).
2. Server settings: turn off anonymous usage/stat collection.
3. Add a library of type **Book**, folder `/books`, and leave **Enable
   metadata** on — with it off, Kavita parses EPUBs by filename only and
   skips them with "Unable to parse any meaningful information".

Only then set up the public name
([setup doc](docs/cloudflare-1password-setup.md), step 3b).

**Adding books.** The library is a PVC mounted at `/books`; one folder per
author works well. Copy files in, then **Scan library** in the UI:

```sh
POD=$(kubectl get pod -n kavita -l app.kubernetes.io/name=kavita -o name)
kubectl exec -n kavita "$POD" -- mkdir -p "/books/Julián Casanova"
kubectl cp "España partida en dos.epub" "kavita/${POD#pod/}:/books/Julián Casanova/"
```

PDFs open in a page viewer (zoom, no reflow); convert them to EPUB first for
the font, spacing and theme controls.

**Where the data is.** Two `local-path` PVCs, both on the Pi the pod first
landed on: `kavita-config` (database: accounts, reading progress; covers;
Kavita's own nightly backups) and `kavita-library` (the files). Neither is
replicated, and Kavita's backups sit on the same volume — back both up
before touching that node ([`docs/rebuild.md`](docs/rebuild.md), step 1).
Deleting the `kavita` Application leaves both PVCs in place on purpose.

### If the site doesn't come up on a fresh cluster

1. **Image.** The chart pulls `ghcr.io/juan-gar/resume-web` by the digest
   that `.github/workflows/build-site.yml` writes back into
   `apps/resume/values.yaml` after each build of `site/`. The GHCR package
   must be public (or add `imagePullSecrets`).
2. **The two values that depend on cluster specifics.** Both defaults are
   right for this cluster, but nothing enforces them — a mismatch shows up as
   panels stuck on cached values, not an error:
   ```sh
   kubectl get svc -n monitoring            # prometheus.proxy.url
   kubectl get svc -n kube-system kube-dns  # prometheus.proxy.resolver (10.96.0.10 on this cluster)
   ```
3. **Public path.** If `juangar.com` hangs or errors while the LAN names work,
   see "What could break" in
   [`docs/public-access-explained.md`](docs/public-access-explained.md).

Sync order mostly doesn't matter — the resume pod starts fine without
Prometheus and its panels fall back to cached values. The one failure mode that
*would* break it (nginx refusing to start when its proxy upstream doesn't
resolve) is deliberately avoided; see the comments in
`apps/resume/templates/configmap.yaml`.

Not yet scaffolded: replicated storage (Longhorn - see
`docs/architecture.md` for why `local-path-provisioner` is standing in for
it). Add new components
as a new file under `clusters/rpi-cluster/platform/` following the pattern in
`envoy-gateway.yaml` or `cert-manager.yaml` (chart + values + a
`platform/<component>/` folder of plain manifests) — see
`docs/architecture.md`.
