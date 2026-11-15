# Train the tiny square classifier and export weights for src/boardscan.js (float32, layer order c1,c2,c3,f1,f2).
import sys, numpy as np, torch, torch.nn as nn, time
torch.set_num_threads(2); torch.manual_seed(0)

class Net(nn.Module):
    def __init__(s):
        super().__init__()
        s.c1 = nn.Conv2d(3, 16, 3, padding=1); s.c2 = nn.Conv2d(16, 32, 3, padding=1); s.c3 = nn.Conv2d(32, 64, 3, padding=1)
        s.f1 = nn.Linear(1024, 64); s.f2 = nn.Linear(64, 13); s.p = nn.MaxPool2d(2); s.r = nn.ReLU(); s.d = nn.Dropout(0.2)
    def forward(s, x):
        x = s.p(s.r(s.c1(x))); x = s.p(s.r(s.c2(x))); x = s.p(s.r(s.c3(x)))
        return s.f2(s.d(s.r(s.f1(x.flatten(1)))))

def load(fs):
    X, Y = [], []
    for f in fs:
        d = np.load(f); X.append(d["X"]); Y.append(d["Y"])
    X = torch.tensor(np.concatenate(X)).permute(0, 3, 1, 2).float() / 255
    return X, torch.tensor(np.concatenate(Y))

if __name__ == "__main__":
    trf, vaf, out, epochs = sys.argv[1].split(","), sys.argv[2], sys.argv[3], int(sys.argv[4])
    X, Y = load(trf); Xv, Yv = load([vaf])
    net = Net(); opt = torch.optim.Adam(net.parameters(), 2e-3)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, 3e-3, total_steps=epochs * (len(X) // 256 + 1))
    lossf = nn.CrossEntropyLoss(label_smoothing=0.05)
    for ep in range(epochs):
        net.train(); perm = torch.randperm(len(X)); t = time.time()
        for i in range(0, len(X), 256):
            b = perm[i:i + 256]; xb = X[b]
            opt.zero_grad(); l = lossf(net(xb), Y[b]); l.backward(); opt.step(); sched.step()
        net.eval()
        with torch.no_grad(): pv = torch.cat([net(Xv[i:i + 2000]).argmax(1) for i in range(0, len(Xv), 2000)])
        acc = (pv == Yv).float().mean().item()
        print(f"epoch {ep+1} loss {l.item():.3f} val {acc:.4f} ({time.time()-t:.0f}s)", flush=True)
    torch.save(net.state_dict(), out + ".pt")
    parts = [net.c1.weight, net.c1.bias, net.c2.weight, net.c2.bias, net.c3.weight, net.c3.bias, net.f1.weight, net.f1.bias, net.f2.weight, net.f2.bias]
    np.concatenate([p.detach().numpy().ravel() for p in parts]).astype("<f4").tofile(out)
    # confusion summary
    cm = np.zeros((13, 13), int)
    for a, b in zip(Yv.numpy(), pv.numpy()): cm[a, b] += 1
    print(cm)
