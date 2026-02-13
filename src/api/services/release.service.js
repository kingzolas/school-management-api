const Release = require('../models/release.model');

class ReleaseService {
  
  // Função que o Controller vai chamar quando o GitHub disparar o Webhook
  async syncGitHubRelease(payload) {
    // O GitHub manda um JSON gigante. Vamos pegar só o objeto 'release'
    const { action, release } = payload;

    // Queremos processar apenas quando a release for publicada ou editada
    if (action !== 'published' && action !== 'released' && action !== 'edited') {
      return null;
    }

    if (!release) return null;

    // Tenta achar um asset .exe (caso você anexe o instalador)
    const exeAsset = release.assets.find(asset => asset.name.endsWith('.exe'));

    // Upsert: Se a versão já existe, atualiza. Se não, cria.
    const updatedRelease = await Release.findOneAndUpdate(
      { tag: release.tag_name },
      {
        tag: release.tag_name,
        name: release.name || release.tag_name,
        body: release.body, // Aqui está o seu Markdown!
        publishedAt: release.published_at,
        htmlUrl: release.html_url,
        downloadUrl: exeAsset ? exeAsset.browser_download_url : null
      },
      { upsert: true, new: true }
    );

    return updatedRelease;
  }

  // Busca todas as versões para a linha do tempo (da mais recente para a mais antiga)
  async getTimeline() {
    return await Release.find()
      .sort({ publishedAt: -1 }) // Decrescente
      .limit(50); // Limita às ultimas 50 para não pesar
  }

  // Busca apenas a última para verificação rápida na Home do App
  async getLatest() {
    return await Release.findOne().sort({ publishedAt: -1 });
  }
}

module.exports = new ReleaseService();