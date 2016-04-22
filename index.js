/* eslint arrow-body-style: 0 */
'use strict';

const nodegit = require('nodegit');
const Repository = nodegit.Repository;
const path = require('path');
const cwd = process.cwd();
const conventionalCommitsParser = require('conventional-commits-parser');

function allCommits(repo) {
  return repo.getMasterCommit()
    .then((firstCommitOnMaster) => {
      return new Promise((resolve, reject) => {
        const history = firstCommitOnMaster.history(nodegit.Revwalk.SORT.Time);
        const commits = [];

        history
          .on('commit', commit => commits.push(commit))
          .on('end', () => resolve(commits))
          .on('error', (err) => reject(err))
          .start();
      });
    });
}

function getStagedFiles(repo) {
  return repo.getStatus()
    .then((arrayStatusFile) => {
      return arrayStatusFile.map(file => ({
        path: file.path(),
        inIndex: file.inIndex() > 0,
      }));
    })
    .then(files => files.filter(file => file.inIndex))
    .then(indexedFiles => indexedFiles.map(file => file.path));
}

function flatten(things) {
  return things.reduce((result, thing) => result.concat(thing), []);
}

function patchedOneOf(files) {
  return (patch) => {
    return files.reduce((result, file) => {
      return result || [
        patch.oldFile().path(),
        patch.newFile().path(),
      ].indexOf(file) !== -1;
    }, false);
  };
}

function checkRelevanceToStagedFiles(commit, stagedFiles) {
  return commit.getDiff()
    .then((diffList) => {
      return Promise.all(diffList.map(diff => diff.patches()))
        .then(flatten)
        .then(patches => patches.filter(patchedOneOf(stagedFiles)))
        .then(relevantPatches => relevantPatches.length > 0);
    });
}

function parseAndEnrich(stagedFiles, config) {
  return (commit) => {
    const parsedCommit = conventionalCommitsParser.sync(commit.message(), config);

    if (parsedCommit.type === null) {
      parsedCommit.relevantToStagedFiles = false;

      return Promise.resolve(parsedCommit);
    }

    return checkRelevanceToStagedFiles(commit, stagedFiles)
      .then(isRelevantToStagedFiles => {
        parsedCommit.relevantToStagedFiles = isRelevantToStagedFiles;

        return parsedCommit;
      });
  };
}

function getLog(someConfig) {
  const config = someConfig || {};

  return Repository.open(path.resolve(config.cwd || cwd))
    .then(repo => Promise.all([
      allCommits(repo),
      getStagedFiles(repo),
    ]))
    .then((args) => {
      const commits = args[0];
      const stagedFiles = args[1];

      return Promise.all(commits.map(parseAndEnrich(stagedFiles, config)));
    });
}

function byScore(a, b) {
  if (a.score > b.score) {
    return -1;
  } else if (a.score < b.score) {
    return 1;
  }

  return 0;
}

class GitLogHelper {
  constructor(config) {
    this.log = getLog(config);
  }
  sortTypesByUsage(types) {
    return this.log
      .then(log => GitLogHelper.sortTypesByUsage(log, types));
  }
  getSortedScopesForType(type) {
    return this.log
      .then(log => GitLogHelper.getSortedScopesForType(log, type));
  }
}

GitLogHelper.sortTypesByUsage = function sortTypesByUsage(log, types) {
  const typeObs = types.map(type => ({ type, score: 0 }));

  log.forEach(commit => {
    const typeOb = typeObs.find(t => t.type === commit.type);

    if (!typeOb) {
      return;
    }

    typeOb.score += 1;
    if (commit.relevantToStagedFiles) {
      typeOb.score += 500;
    }
  });

  return typeObs.sort(byScore).map(typeOb => typeOb.type);
};

GitLogHelper.getSortedScopesForType = function getSortedScopesForType(log, type) {
  const scopes = log.reduce((result, commit) => {
    if (!commit.scope) {
      return result;
    }

    let scope = result
      .find(scopeObj => scopeObj.name === commit.scope);

    if (!scope) {
      scope = {
        score: 0,
        name: commit.scope,
      };

      result.push(scope);
    }

    scope.score += 1;

    if (type === commit.type) {
      scope.score += 50;
    }

    if (commit.relevantToStagedFiles) {
      scope.score += 500;
    }

    return result;
  }, []).sort(byScore);

  return scopes.map(scope => scope.name);
};

module.exports = GitLogHelper;

