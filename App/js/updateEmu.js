/*
	******************************************************************************
	fpPS4 Temmie's Launcher
	updateEmu.js

	This file is responsible for feching latest data from red-prig fpPS4 actions
	and update.
	******************************************************************************
*/

temp_EMU_UPDATE = {

	// Skip main loading call
	skipLoadingCheck: !1,

	// Fetch data from url
	fetchData: async function(url, callback){

		// If url was provided
		if (url !== void 0 && navigator.onLine === !0 && typeof callback === 'function'){

			// Get error message and fetch data
			const errMsg = APP.lang.getVariable('updateEmuFetchActionsError');
			fetch(url).then(function(resp){

				// Check if fetch status is ok
				if (resp.ok === !0){

					resp.json().then(function(jsonData){
						callback(jsonData);
					});

				} else {

					// If launcher can't get data, log error and reset button
					document.getElementById('BTN_UPDATE_FPPS4').disabled = '';
					console.error(errMsg);
					APP.log(errMsg);

				}

			});

		}

	},

	// Get all available workflows
	getWorkflows: function(){

		// Process workflows
		const processWorkflows = function(data){

			// Variables
			var htmlTemp = `<option disabled>${APP.lang.getVariable('updater_noWorkflowListAvailable')}</option>`;

			// Check if data is provided
			if (data !== void 0){

				// Reset html temp and process workflow list
				htmlTemp = '';
				data.workflows.forEach(function(cData){
					htmlTemp = `${htmlTemp}<option value="${cData.name}">${cData.name}</option>`;
				});

			}

			// Append HTML
			document.getElementById('SELECT_settingsUpdaterCurrentCI').innerHTML = htmlTemp;

		}

		// Fetch data
		fetch('https://api.github.com/repos/red-prig/fpPS4/actions/workflows').then(function(resp){

			// Check if fetch status is ok
			if (resp.ok === !0){

				resp.json().then(function(jsonData){
					processWorkflows(jsonData);
				});

			} else {

				// If launcher can't get data, log error and reset button
				console.error(errMsg);
				APP.log(errMsg);

			}

		});

	},

	/*
		Fetch latest github actions

		options: Object
			jsonData: 	 Object - GitHub actions list (json)
			forceUpdate: Boolean - Skip checks and download latest version available
			silent: 	 Boolean - Don't show message if user already have latest version
	*/
	check: function(options){
		
		// Process options
		if (options === void 0){
			options = { forceUpdate: !1, silent: !1 };
		}
		var fetchData = this.fetchData,
			workflowLink = 'https://api.github.com/repos/red-prig/fpPS4/actions/workflows',
			optionsList = ['forceUpdate', 'silent'].forEach(function(optId){
				if (options[optId] === void 0){
					options[optId] = !1;
				}
			});

		// If Emu updates is available, has internet and fpPS4 isn't running
		if (APP.settings.data.enableEmuUpdates === !0 && navigator.onLine === !0 && APP.emuManager.emuRunning === !1){

			// Disable check for updates emu
			document.getElementById('BTN_UPDATE_FPPS4').disabled = 'disabled';

			// Fetch worflow list
			fetchData(workflowLink, function(data){

				// Set json
				options['wList'] = data;

				// Variables
				var sWorkflow,
					wList = options.wList.workflows;

				// Seek selected ci
				for (var i = 0; i < wList.length; i++){
					if (wList[i].name === APP.settings.data.fpps4selectedCI){
						sWorkflow = i;
						break;
					}
				}

				// Get workflow runs
				if (sWorkflow !== void 0){

					fetchData(`${workflowLink}/${wList[sWorkflow].id}/runs`, function(data){
						options['runs'] = data;
						APP.emuManager.update.processActions(options);
					});
				
				} else {

					// If not found, log it
					const errMsg = APP.lang.getVariable('updateEmuWorkflow404');
					console.error(errMsg);
					APP.log(errMsg);

				}

			});

		}

	},

	// Process github actions data
	processActions: function(options){

		// Check if data was provided
		if (options !== void 0){

			// Variables
			var winConf,
				msgData = '',
				artifactData,
				canPrompt = !0,
				canUpdate = !1,
				latestCommit = '',
				msgMode = 'confirm',
				settingsData = APP.settings.data;

			// Seek for latest success run
			for (var i = 0; i < options.runs.workflow_runs.length; i++){

				// Get current run data
				const cRun = options.runs.workflow_runs[i];

				// Check if status is completed (with a success build) and it is from same branch
				if (cRun.status === 'completed' && cRun.conclusion === 'success' && cRun.head_branch === settingsData.fpps4BranchName){

					// Set can update on
					canUpdate = !0;

					// Set run info
					artifactData = {
						artifact: cRun.id,
						sha: cRun.head_sha
					}
					break;
				}

			}

			// If found valid run
			if (artifactData !== void 0){

				// Check if current version is latest commit (or force update is on)
				if (settingsData.latestCommitSha !== artifactData.sha || options.forceUpdate === !0){

					// Set default update message
					msgData = APP.lang.getVariable('updateEmuShaAvailable', [settingsData.latestCommitSha.slice(0, 7), artifactData.sha.slice(0, 7)]);

					// If user didn't updated yet using launcher or executable was not found
					if (settingsData.latestCommitSha === '' || APP.fs.existsSync(settingsData.emuPath) === !1){
						msgData = APP.lang.getVariable('updateEmuShaUnavailable');
					}

				} else {

					// If silent is active
					if (options.silent === !0){
						canPrompt = !1;
					}
					
					// User already have latest version
					if (settingsData.latestCommitSha === artifactData.sha && APP.fs.existsSync(settingsData.emuPath) === !0){

						// Set message mode to alert and get message for latest version
						msgMode = 'alert';
						msgData = APP.lang.getVariable('updateEmuIsLatestVersion', [settingsData.latestCommitSha.slice(0, 7)]);

					}

				}

			}

			// Check if can update
			if (canUpdate === !0 && canPrompt === !0){
				winConf = window[msgMode](msgData);
			}

			// If can update and user confirms action or can update and force update is on
			if (msgMode === 'confirm' && winConf === !0 || canUpdate === !0 && options.forceUpdate === !0){
				this.getZipFile(artifactData);
			}

		}

		// Enable updater button again
		document.getElementById('BTN_UPDATE_FPPS4').disabled = '';

	},

	/*
		Get zip from specific github action run

		Since GitHub requires a token to be able to download artifacts, nightly.links service will be used instead.
		https://nightly.link
	*/
	getZipFile: function(actionsData){

		// If (by some reason) fpPS4 is running - close it!
		APP.emuManager.killEmu();

		// Display GUI
		APP.design.toggleEmuUpdateGUI('show');
		APP.design.updateProgressbarStatus(25, APP.lang.getVariable('updateEmu-1-4', [actionsData.sha.slice(0, 7)]));

		// Start download
		fetch(`https://nightly.link/red-prig/fpPS4/actions/runs/${actionsData.artifact}/fpPS4.zip`).then(function(resp){

			if (resp.ok === !0){

				APP.https.get(resp.url, function(data){

					const
						fPath = `${APP.settings.data.nwPath}/Emu/fpPS4.zip`,
						writeStream = APP.fs.createWriteStream(fPath);

					data.pipe(writeStream);
					writeStream.on('finish', function(){

						// Close writestream and extract emu executable
						writeStream.close();
						APP.emuManager.update.extractZip({
							actions: actionsData,
							path: fPath
						});

					});

				});

			} else {

				console.error(resp);
				APP.log(APP.lang.getVariable('updateEmuDownloadFailed', [resp.status, resp.ok]));

			}

		});

	},

	// Extract zip
	extractZip: function(data){

		// Update status, open and extract zip file
		APP.design.updateProgressbarStatus(50, APP.lang.getVariable('updateEmu-2-4'));
		const updateFile = new APP.streamZip.async({ file: data.path });
		updateFile.extract(null, `${APP.path.parse(data.path).dir}/`, function(err){
			if (err){
				console.error(err);
			}
		}).then(function(){

			// Close zip and finish process
			updateFile.close();
			APP.emuManager.update.finish(data);

		});

	},

	// Finish process
	finish: function(data){

		// Update status
		APP.design.updateProgressbarStatus(75, APP.lang.getVariable('updateEmu-3-4'));

		// Remove download file and update settings
		APP.fs.unlinkSync(data.path);
		APP.settings.data.latestCommitSha = data.actions.sha;
		APP.settings.data.emuPath = `${APP.path.parse(data.path).dir}/fpPS4.exe`;

		// Save settings and update progressbar
		APP.settings.save();
		const processCompleteMsg = APP.lang.getVariable('updateEmuProcessComplete', [data.actions.sha.slice(0, 7)]);
		APP.design.updateProgressbarStatus(100, APP.lang.getVariable('updateEmu-4-4'));

		// Timing out just to update GUI
		setTimeout(function(){

			// Display message and hide update gui
			APP.log(processCompleteMsg);
			window.alert(processCompleteMsg);
			APP.design.toggleEmuUpdateGUI('hide');

		}, 410);

	}

}