I want to make an app or server what ever is better for the following but the user interface should be in browser so I can access it remotely the app should support the handy toy and funscripts 


its a app to filter and view adulte content.
but i should also contain a content filter option.



the user should be able to select one or more folders on the system the server/app is running
but these folders should always contain these folders 'before filter performer', 'content', 'after filter performer'

first i will explain how the folder structure looks like then i will explain some functionality 

the 'before filter performer' folder will be a folder on the system that contains subfolder for each performer in these performer folders their will be folder with pic and vids
the 'content' folder will just contain content not grouped by performers but their will be subfolders in it per genre
the 'after filter performer' this will be empty at the start and this is the folder that the performers will be moved to when their are filtered

**IMPORTANT DISTINCTION:**
- **Gallery Mode**: Shows only performers from the 'after filter performer' folder (completed/filtered performers)
- **Filter Mode**: Shows only performers from the 'before filter performer' folder (unfiltered performers awaiting processing)

in each vids folder of performer their could be a funscript folder in this folder their will be vids with funscript each video with funscripts should have his own subfolder with the name of the vid and containing the vid and all funscripts that this video can use 

when the app is started their should always open a browser window to the interface 
the fist time the user opens the app he just only see a big + button to add a folder the user should be able to select a folder with the right structure or be able to make a folder that will get this structure 

the app should always be in just the gallery mode when starting their should be a tool bar with a way to toggle between filter and gallery mode a performer button to toggle between performer and content mode 
and a place to add tags and filtering options it would like this to be at the side of the interface here should also be a inputfield for the handy contention code 

when the app scans the 'before filter performer' folder and finds a new performer their should be a indications somewhere and the user should be able to import it to the app when importing the user should be able to view the files and rename the folder. also during this all pics in this folder should be renamed and moved to a subfolder in the current performers folder the same for the vids but in the vids subfolder should the funscript folder also be made 

when imported the performer should be able to be viewed in the filter sections
the performer cards in each sections should contain how many vids with funscripts it has, how many funscripts it has, how many pics, how many vids, the size in gb this should be a number with a fitting svg icon?
and a random image of the performer i can change with button on the performers cards.
in the filter view i should also be able to see how many of the total files have been filtered 
in the gallery view i should be able to click the performer to see all the pics vids and the vids with funscripts should each of their own sections is should be able to toggle these sections and i should be able to sort them by name size date and the funscript count per vid
in the filter mode each performer should have 3 buttons the go the vids, pics and vids with funscript filtering

**MODE BEHAVIOR:**
- **Filter Mode**: Shows only performers from 'before filter performer' folder (for filtering), no content sections visible
- **Gallery Mode**: Shows only performers from 'after filter performer' folder (completed), plus content sections from 'content' folder

the content genres should just show a placeholder svg icon and the size and how many pics and vids are in it again With a fittin svg icon 

in the filter mode i should be albe to sort so i can filter from biggest file to smallest or by name or date 
in filter mode i should be albe to choose if i keep or delete i should also be albe to undo my last choice
when filter vids i should be albe to keep and move to the funscirpt folder with it own subfolder maybe name it funscript this option 
i should also be albe to give each filtering option is shortcut button this could be a keyboard or mouse button 
when filtering the funscript vids it should only show the vids in the funscript folder that actually have funscripts filles in their subfolder
in this filtering is should be able to choose what funscript files is uploaded and for Each funscript file be able to choose to keep or delete i just also be able to rename these funscripts files here 
if i delete the last funscript file for the current video is should prompted to choose to keep vid (and move the vids folder and mark them as keep) or delete them

when in filtering mode if i click a performer i should see some settings to be albe to set the vids pics and funscript vids sorting manually to done. and to move the performer to the "after filter performer' folder this should never happen automatic but their could be a indication on the card that a performer is ready to be moved
and i should be able to delete al saved date of this performer so have to import it again
and i should be able to just delete the folder from the system

when i move a performer to the after folder and their is already a performer with the same name i should be asked if i want to merge or just cancel the move i should also be albe to choose if i merge if i want to keep the current card tumbnail image 
if this appens when importing i should get the same


also split up most features and interface in their own code file so they dont become to long and for max code reuse





