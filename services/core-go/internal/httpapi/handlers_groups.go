package httpapi

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/esoqo/core-go/internal/dbx"
)

type createGroupRequest struct {
	OrgKind      string `json:"orgKind" binding:"required"`
	OfficialName string `json:"officialName" binding:"required"`
	KnownAs      string `json:"knownAs"`
	County       string `json:"county" binding:"required"`
}

func (s *Server) handleCreateGroup(c *gin.Context) {
	ctx := ctxFromGin(c)
	var req createGroupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	orgID, err := dbx.CreateOwnGroup(c.Request.Context(), s.Pool, ctx.PartyID, req.OrgKind, req.OfficialName, req.KnownAs, req.County)
	if err != nil {
		writeSafeError(c, http.StatusBadRequest, "CREATE_FAILED", err, "Could not create this group")
		return
	}
	c.JSON(http.StatusOK, gin.H{"groupId": orgID})
}

func (s *Server) handleJoinGroup(c *gin.Context) {
	ctx := ctxFromGin(c)
	status, err := dbx.JoinGroup(c.Request.Context(), s.Pool, ctx.PartyID, c.Param("id"))
	if err != nil {
		if err == dbx.ErrAlreadyMember {
			writeSafeError(c, http.StatusConflict, "ALREADY_MEMBER", err, "You are already a member of this group")
			return
		}
		writeError(c, http.StatusInternalServerError, "JOIN_FAILED", "Could not join that group")
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": status})
}

func (s *Server) handleSearchGroups(c *gin.Context) {
	groups, err := dbx.SearchGroupsPublic(c.Request.Context(), s.Pool, c.Query("q"))
	if err != nil {
		writeError(c, http.StatusInternalServerError, "SEARCH_FAILED", "Could not search groups")
		return
	}
	c.JSON(http.StatusOK, gin.H{"groups": groups})
}

func (s *Server) handleListMyGroups(c *gin.Context) {
	ctx := ctxFromGin(c)
	groups, err := dbx.ListMyGroups(c.Request.Context(), s.Pool, ctx.PartyID)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load your groups")
		return
	}
	c.JSON(http.StatusOK, gin.H{"groups": groups})
}

func (s *Server) handleGetGroup(c *gin.Context) {
	ctx := ctxFromGin(c)
	group, err := dbx.GetGroup(c.Request.Context(), s.Pool, c.Param("id"))
	if err != nil {
		writeError(c, http.StatusInternalServerError, "GET_FAILED", "Could not load that group")
		return
	}
	if group == nil {
		writeError(c, http.StatusNotFound, "NOT_FOUND", "Group not found")
		return
	}
	isMember := false
	for _, m := range group.Members {
		if m.PersonID == ctx.PartyID {
			isMember = true
			break
		}
	}
	if !isMember {
		writeError(c, http.StatusForbidden, "NOT_A_MEMBER", "You are not a member of this group")
		return
	}
	c.JSON(http.StatusOK, group)
}
