# Homebrew formula skeleton for Open Hipp0.
#
# Tap + install:
#   brew tap openhipp0/tap
#   brew install openhipp0
#
# The real formula lives in https://github.com/openhipp0/homebrew-tap — this
# file is a reference copy so the tap and the main repo stay in sync.

class Openhipp0 < Formula
  desc "Local-first autonomous AI agent platform"
  homepage "https://openhipp0.com"
  url "https://registry.npmjs.org/@openhipp0/cli/-/cli-0.0.0.tgz"
  sha256 "0" * 64
  license "Apache-2.0"

  depends_on "node@22"
  depends_on "pnpm"

  def install
    system "npm", "install", "--global", "--prefix=#{libexec}", buildpath
    bin.install_symlink Dir["#{libexec}/bin/hipp0"]
  end

  test do
    assert_match "0", shell_output("#{bin}/hipp0 --version")
  end

  def caveats
    <<~EOS
      Open Hipp0 stores its config in ~/.hipp0/. Override via HIPP0_HOME.

      Next steps:
        hipp0 init            # interactive wizard
        hipp0 migrate openclaw
        hipp0 doctor
    EOS
  end
end
