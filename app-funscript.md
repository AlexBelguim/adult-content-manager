so i want a player that can be used globally 
this player should be its on <> that can be used everywhere in the app
for both preview and playback  
this tag should also handle video preview generation (so this tag can be use in the unified-gallery.html page instead of a img that triggers a modal with vid)
- preview should always take all the space it can so dont use the resized images to create this 
maybe to keep consistend also create a custom img tag so this also can be used in the unified-gallery.html page
this should be in his own file (maybe in utils?)

their should be a button on the top right of any video previews and inside the fullscreen view of any videos 
this button should let the user select a funscript to upload if their is more than one if their is only one it should upload this

the button should just contain a robot icon 
change this icon to show the state
- uploading 
- worked 
- failed 

in the filterview the current funscript handling should be deleted and in the this view the button should always give the user 
the choice not only when their is only 1 script 
but here their should also be a keep and delete button for each script 
- maybe add an addribution to the tag (like the sytle) to choose if its the filtering or normal choice 


in the html dom i want to see a custom tag <funscript-player>
both video play and preview should be handled with this tag 
the fact if the video should show A preview that opens a modal to play video (unified-gallery) or just he video player with a preview images as placeholder (filterview)
- normal fullsized video/picture that plays without modal that is contained in the space given (so fully shown dont use reside images) <funscript-player  mode="standalone" view="containe">
- a tumbnail that streches the availbe space given you have to click on to open a modal (this modal should have a non transparent background should looke like it replaces the page) to watch the video or picture
 <funscript-player  mode="modal" view="streched">
- this player script should be selfcontained and to make it work just the script should be imported in the pages used and then <funscript-player> wherever you want it 
- add <funscript-player filtermode="true"> or <funscript-player filtermode="false"> to show it the keep or delete button should be their 
- also add funscriptmode="true or false" 



