import importlib


def test_daemon_reload_user_env_overrides_stale_provider(monkeypatch, tmp_path):
    cfg_dir = tmp_path / ".config" / "openreply"
    cfg_dir.mkdir(parents=True)
    env_path = cfg_dir / ".env"
    env_path.write_text(
        "LLM_PROVIDER=nvidia\n"
        "LLM_MODEL=meta/llama-3.3-70b-instruct\n"
        "NVIDIA_API_KEY=nvapi-test\n",
        encoding="utf-8",
    )

    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("LLM_PROVIDER", "ollama")
    monkeypatch.setenv("LLM_MODEL", "llama3.2:3b")
    monkeypatch.delenv("NVIDIA_API_KEY", raising=False)

    main = importlib.import_module("openreply.cli.main")

    main._reload_user_env_for_daemon()

    assert main.os.environ["LLM_PROVIDER"] == "nvidia"
    assert main.os.environ["LLM_MODEL"] == "meta/llama-3.3-70b-instruct"
    assert main.os.environ["NVIDIA_API_KEY"] == "nvapi-test"
